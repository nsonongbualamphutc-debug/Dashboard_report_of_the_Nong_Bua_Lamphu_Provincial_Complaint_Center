/*************************************************************
 * ศูนย์ดำรงธรรมจังหวัดหนองบัวลำภู — Backend (Code.gs)
 * ระบบกรอก/อ่านข้อมูลเรื่องร้องเรียน ปีงบประมาณ 2569
 *
 * โครงสร้าง: ชีตแยกรายอำเภอ (เดิม) + ชีตคุ้มครองผู้บริโภคแยกต่างหาก
 * เชื่อมต่อแบบ JSONP (กัน CORS) เหมือนระบบเดิม
 *
 * วิธีติดตั้ง:
 *  1) เปิด Sheet เป้าหมาย > ส่วนขยาย > Apps Script > วางไฟล์นี้
 *  2) แก้ชื่อแท็บใน DISTRICT_SHEETS / CONSUMER_SHEET ให้ตรงกับชีตจริง
 *  3) รันฟังก์ชัน setup() หนึ่งครั้ง (ตั้ง PIN + ตรวจหัวตาราง)
 *  4) Deploy > New deployment > Web app
 *       - Execute as: Me
 *       - Who has access: Anyone
 *  5) คัดลอก URL /exec ไปวางในไฟล์ entry.html และแดชบอร์ด
 *************************************************************/

/* ====================== CONFIG ====================== */
// ชื่อแท็บรายอำเภอ — แก้ให้ตรงกับชีตจริงของนาย
const DISTRICT_SHEETS = [
  'เมืองหนองบัวลำภู',
  'ศรีบุญเรือง',
  'นากลาง',
  'โนนสัง',
  'สุวรรณคูหา',
  'นาวัง'
];
const CONSUMER_SHEET = 'คุ้มครองผู้บริโภค';

// หัวตารางชีตอำเภอ (A..L)  — ตรงกับชีตปัจจุบัน
const DIST_HEADERS = ['ที่','ชื่อเรื่อง','ผู้ร้องเรียน','ผู้ถูกร้องเรียน','ประเภท',
  'วันที่ร้องเรียน','กำหนดรายงาน','รายละเอียด','ช่องทาง','หน่วยงานรับผิดชอบ','สถานะ','การเร่งรัด'];

// หัวตารางชีตคุ้มครองผู้บริโภค (A..H)
const CONS_HEADERS = ['ชื่อเรื่อง','ผู้ร้องเรียน','ผู้ถูกร้องเรียน',
  'วันที่ร้องเรียน','กำหนดรายงาน','รายละเอียด','สถานะ','หมายเหตุ'];

const STATUS_DONE = 'ยุติแล้ว';
const STATUS_PROG = 'อยู่ระหว่างดำเนินการ';

/* ====================== ROUTER ====================== */
function doGet(e){
  const p = e.parameter || {};
  const cb = p.callback || 'callback';
  let out;
  try{
    switch(p.action){
      case 'all':       out = {ok:true, ...getAllData_()}; break;          // แดชบอร์ด
      case 'list':      out = {ok:true, rows:listSheet_(p.sheet)}; break;  // ฟอร์มดึงรายการ
      case 'add':       out = writeAction_('add', p); break;
      case 'edit':      out = writeAction_('edit', p); break;
      case 'delete':    out = writeAction_('delete', p); break;
      default:          out = {ok:false, error:'unknown action'};
    }
  }catch(err){ out = {ok:false, error:String(err)}; }
  return jsonp_(cb, out);
}

/* ====================== READ ====================== */
// รวมข้อมูลทุกอำเภอ + คุ้มครองผู้บริโภค สำหรับแดชบอร์ด
function getAllData_(){
  const records = [];
  DISTRICT_SHEETS.forEach(name=>{
    const sh = sheet_(name); if(!sh) return;
    sheetObjects_(sh, DIST_HEADERS).forEach(o=>{
      if(!o['ชื่อเรื่อง']) return;
      records.push({
        district: name,
        no:        o['ที่'],
        title:     o['ชื่อเรื่อง'],
        complainant:o['ผู้ร้องเรียน'],
        accused:   o['ผู้ถูกร้องเรียน'],
        type:      o['ประเภท'],
        dateIn:    fmtDate_(o['วันที่ร้องเรียน']),
        deadline:  fmtDate_(o['กำหนดรายงาน']),
        detail:    o['รายละเอียด'],
        channel:   o['ช่องทาง'],
        agency:    o['หน่วยงานรับผิดชอบ'],
        status:    o['สถานะ'],
        urge:      o['การเร่งรัด']
      });
    });
  });

  // คุ้มครองผู้บริโภค (แยก)
  const consumer = [];
  const csh = sheet_(CONSUMER_SHEET);
  if(csh){
    sheetObjects_(csh, CONS_HEADERS).forEach(o=>{
      if(!o['ชื่อเรื่อง']) return;
      consumer.push({
        title:o['ชื่อเรื่อง'], complainant:o['ผู้ร้องเรียน'], accused:o['ผู้ถูกร้องเรียน'],
        dateIn:fmtDate_(o['วันที่ร้องเรียน']), deadline:fmtDate_(o['กำหนดรายงาน']),
        detail:o['รายละเอียด'], status:o['สถานะ'], note:o['หมายเหตุ']
      });
    });
  }

  // สรุปสำเร็จรูป
  const summary = {
    total: records.length,
    done:  records.filter(r=>r.status===STATUS_DONE).length,
    prog:  records.filter(r=>r.status===STATUS_PROG).length,
    byDistrict:{}, byType:{}, byChannel:{}
  };
  records.forEach(r=>{
    add_(summary.byDistrict, r.district);
    add_(summary.byType, r.type);
    add_(summary.byChannel, r.channel);
  });

  return { records, consumer, summary, updated: fmtDate_(new Date()) };
}

// ดึงรายการของชีตเดียว (สำหรับหน้าฟอร์มแก้ไข) พร้อมเลขแถวจริง
function listSheet_(name){
  const sh = sheet_(name); if(!sh) throw 'ไม่พบชีต: '+name;
  const isCons = (name===CONSUMER_SHEET);
  const headers = isCons ? CONS_HEADERS : DIST_HEADERS;
  const last = sh.getLastRow();
  if(last < 2) return [];
  const data = sh.getRange(2,1,last-1,headers.length).getValues();
  const rows = [];
  data.forEach((row,i)=>{
    const titleCol = isCons ? 0 : 1;          // ชื่อเรื่อง
    if(!row[titleCol]) return;
    const o = { _row: i+2 };                    // เลขแถวจริงในชีต
    headers.forEach((h,c)=> o[h] = (h.indexOf('วันที่')>=0||h.indexOf('กำหนด')>=0) ? fmtDate_(row[c]) : row[c]);
    rows.push(o);
  });
  return rows;
}

/* ====================== WRITE ====================== */
function writeAction_(mode, p){
  if(!verifyPin_(p.pin)) return {ok:false, error:'PIN ไม่ถูกต้อง'};
  const name = p.sheet;
  const sh = sheet_(name); if(!sh) return {ok:false, error:'ไม่พบชีต: '+name};
  const isCons = (name===CONSUMER_SHEET);
  const headers = isCons ? CONS_HEADERS : DIST_HEADERS;

  // สร้าง array ค่าจาก parameter (key = ชื่อหัวตาราง)
  function buildRow(){
    return headers.map(h=>{
      if(h==='ที่') return '';                  // เติมเลขทีหลังตอน renumber
      return p[h]!==undefined ? p[h] : '';
    });
  }

  if(mode==='add'){
    const r = nextRow_(sh, isCons?0:1);         // แถวว่างแรก
    sh.getRange(r,1,1,headers.length).setValues([buildRow()]);
    if(!isCons) renumber_(sh);
    return {ok:true, row:r};
  }

  if(mode==='edit'){
    const r = parseInt(p.row,10);
    if(!(r>=2)) return {ok:false, error:'เลขแถวไม่ถูกต้อง'};
    const vals = buildRow();
    if(!isCons) vals[0] = sh.getRange(r,1).getValue() || ''; // คงเลข "ที่"
    sh.getRange(r,1,1,headers.length).setValues([vals]);
    return {ok:true, row:r};
  }

  if(mode==='delete'){
    const r = parseInt(p.row,10);
    if(!(r>=2)) return {ok:false, error:'เลขแถวไม่ถูกต้อง'};
    sh.getRange(r,1,1,headers.length).clearContent();  // เคลียร์เพื่อให้แถวถูกใช้ซ้ำ
    if(!isCons) renumber_(sh);
    return {ok:true, deleted:r};
  }
  return {ok:false, error:'mode ไม่ถูกต้อง'};
}

/* ====================== HELPERS ====================== */
function sheet_(name){ return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }

function sheetObjects_(sh, headers){
  const last = sh.getLastRow(); if(last<2) return [];
  const data = sh.getRange(2,1,last-1,headers.length).getValues();
  return data.map(row=>{ const o={}; headers.forEach((h,c)=>o[h]=row[c]); return o; });
}

// แถวว่างแรก (ดูจากคอลัมน์ชื่อเรื่อง) เริ่มที่แถว 2
function nextRow_(sh, titleColIdx){
  const last = Math.max(sh.getLastRow(),1);
  if(last<2) return 2;
  const col = sh.getRange(2,titleColIdx+1,last-1,1).getValues();
  for(let i=0;i<col.length;i++){ if(!col[i][0]) return i+2; }
  return last+1;
}

// เติมเลขลำดับ "ที่" ใหม่ให้ต่อเนื่อง (เฉพาะชีตอำเภอ)
function renumber_(sh){
  const last = sh.getLastRow(); if(last<2) return;
  const titles = sh.getRange(2,2,last-1,1).getValues(); // คอลัมน์ B
  let n=0;
  const out = titles.map(t=> t[0] ? [++n] : ['']);
  sh.getRange(2,1,last-1,1).setValues(out);
}

function add_(obj,k){ if(!k) return; obj[k]=(obj[k]||0)+1; }

function fmtDate_(v){
  if(v instanceof Date){
    const d=v.getDate(), m=v.getMonth()+1, y=v.getFullYear()+543;
    return d+'/'+m+'/'+y;
  }
  return v===undefined||v===null ? '' : String(v).trim();
}

function jsonp_(cb, obj){
  return ContentService
    .createTextOutput(cb+'('+JSON.stringify(obj)+')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/* ---------- PIN (เก็บแบบ hash ใน Script Property) ---------- */
function verifyPin_(pin){
  if(!pin) return false;
  const stored = PropertiesService.getScriptProperties().getProperty('PIN_HASH');
  if(!stored) return false;
  return sha256_(String(pin)) === stored;
}
function sha256_(s){
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return raw.map(b=>('0'+(b&0xFF).toString(16)).slice(-2)).join('');
}

/* ====================== SETUP ====================== */
// รันครั้งเดียวเพื่อ: ตั้ง PIN + ตรวจ/สร้างหัวตาราง + สร้างชีตที่ขาด
function setup(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ตั้ง PIN เริ่มต้น 393909 (เก็บเป็น hash) — เปลี่ยนได้ภายหลัง
  PropertiesService.getScriptProperties().setProperty('PIN_HASH', sha256_('393909'));

  // ชีตอำเภอ
  DISTRICT_SHEETS.forEach(name=>{
    let sh = ss.getSheetByName(name) || ss.insertSheet(name);
    ensureHeaders_(sh, DIST_HEADERS);
  });
  // ชีตคุ้มครองผู้บริโภค
  let cs = ss.getSheetByName(CONSUMER_SHEET) || ss.insertSheet(CONSUMER_SHEET);
  ensureHeaders_(cs, CONS_HEADERS);

  SpreadsheetApp.getUi().alert('ตั้งค่าเรียบร้อย ✓  (PIN = 393909)\nกรุณา Deploy เป็น Web app เพื่อใช้งาน');
}

function ensureHeaders_(sh, headers){
  const cur = sh.getRange(1,1,1,headers.length).getValues()[0];
  const empty = cur.every(c=>!c);
  if(empty) sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold');
}

// (ทางเลือก) เปลี่ยน PIN ใหม่ — แก้ค่าแล้วรัน
function changePin(){
  const NEW_PIN = '393909';
  PropertiesService.getScriptProperties().setProperty('PIN_HASH', sha256_(NEW_PIN));
}
