require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 10, fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(jpe?g|png|pdf|docx?|xlsx?)$/i.test(file.originalname);
    cb(ok ? null : new Error('Недопустимый тип файла'), ok);
  }
});

app.use(express.static(path.join(__dirname, 'public')));

function text(v, max=5000){ return String(v ?? '').trim().slice(0,max); }
function parseEquipment(raw){
  let x; try{x=JSON.parse(raw||'[]')}catch{throw new Error('Некорректные данные оборудования')}
  if(!Array.isArray(x)||x.length<1||x.length>30) throw new Error('Допустимо от 1 до 30 изделий');
  return x.map((e,i)=>({
    n:i+1, model:text(e['Модель'],200), date:text(e['Дата выпуска'],80), serial:text(e['Серийный №'],120),
    qty:text(e['Кол-во'],20), defect:text(e['Неисправность'],1500), note:text(e['Примечание'],1500)
  }));
}
function buildDescription(b,equipment){
  const items=equipment.map(e=>`\n${e.n}. ${e.model}\nДата выпуска: ${e.date||'—'}\nСерийный №: ${e.serial||'—'}\nКоличество: ${e.qty}\nЗаявленная неисправность: ${e.defect}\nПримечание: ${e.note||'—'}`).join('\n');
  return `ЗАЯВКА В РЕМОНТ\n\nТип обращения: ${text(b.type,100)}\nОрганизация: ${text(b.org,300)}\nИНН: ${text(b.inn,50)}\nКонтактное лицо: ${text(b.person,300)}\nТелефон: ${text(b.phone,100)}\nE-mail: ${text(b.email,300)}\nФактический адрес: ${text(b.address,500)}\n№ обращения в техподдержку: ${text(b.supportNo,100)||'не указан'}\n\nОБОРУДОВАНИЕ:${items}\n\nДополнительное описание:\n${text(b.details,5000)||'—'}`;
}

app.post('/api/repair', upload.array('files',10), async (req,res)=>{
  try{
    const required=['type','org','inn','person','phone','email','address'];
    for(const k of required) if(!text(req.body[k])) return res.status(400).json({error:`Не заполнено обязательное поле: ${k}`});
    const equipment=parseEquipment(req.body.equipment);
    for(const e of equipment) if(!e.model||!e.qty||!e.defect) return res.status(400).json({error:`Проверьте обязательные поля изделия №${e.n}`});
    const title=`Заявка в ремонт — ${text(req.body.org,180)}`;
    const description=buildDescription(req.body,equipment);
    const preview={title,description,files:(req.files||[]).map(f=>({name:f.originalname,size:f.size}))};

    if(String(process.env.DEMO_MODE).toLowerCase()!=='false') return res.json({ok:true,demo:true,preview});
    const account=process.env.OKDESK_ACCOUNT;
    const token=process.env.OKDESK_API_TOKEN;
    if(!account||!token) return res.status(500).json({error:'На сервере не настроены OKDESK_ACCOUNT/OKDESK_API_TOKEN'});

    const fd=new FormData();
    fd.append('issue[title]',title);
    fd.append('issue[description]',description);
    if(process.env.OKDESK_ISSUE_TYPE) fd.append('issue[type]',process.env.OKDESK_ISSUE_TYPE);
    if(process.env.OKDESK_GROUP_ID) fd.append('issue[group_id]',process.env.OKDESK_GROUP_ID);
    (req.files||[]).forEach((f,i)=>{
      fd.append(`issue[attachments][${i}][attachment]`,f.buffer,{filename:f.originalname,contentType:f.mimetype});
      fd.append(`issue[attachments][${i}][is_public]`,'true');
      fd.append(`issue[attachments][${i}][description]`,'Вложение из формы заявки в ремонт');
    });
    const url=`https://${account}.okdesk.ru/api/v1/issues/?api_token=${encodeURIComponent(token)}`;
    const r=await axios.post(url,fd,{headers:fd.getHeaders(),maxBodyLength:50*1024*1024,timeout:30000});
    res.json({ok:true,demo:false,issueId:r.data?.id||null});
  }catch(err){
    const api=err.response?.data;
    console.error('repair error', api||err.message);
    res.status(err.response?.status||500).json({error: api?.errors ? JSON.stringify(api.errors) : (err.message||'Ошибка сервера')});
  }
});

app.use((err,_req,res,_next)=>res.status(400).json({error:err.message||'Ошибка загрузки файла'}));
app.listen(PORT,()=>console.log(`Argus repair form: http://localhost:${PORT} | DEMO_MODE=${process.env.DEMO_MODE||'true'}`));
