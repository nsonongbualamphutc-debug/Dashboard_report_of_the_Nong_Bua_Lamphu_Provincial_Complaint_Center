/*************************************************************
 * ศูนย์ดำรงธรรมจังหวัดหนองบัวลำภู — Backend v2 (Code.gs)
 * ระบบภายในติดตามงานเรื่องร้องเรียน ปีงบประมาณ 2569
 *
 * จุดเด่น v2:
 *  - ตรวจจับชีตอัตโนมัติจาก "หัวตาราง" (ไม่ต้องระบุชื่อแท็บตายตัว)
 *  - อ่าน/เขียนอิงชื่อหัวคอลัมน์ (คอลัมน์สลับก็ยังถูก)
 *  - action=ping ไว้เช็คว่าเชื่อมต่อได้ พบชีตอะไรบ้าง
 *
 * ติดตั้ง:
 *  1) วางไฟล์นี้ใน Apps Script ของ Sheet เป้าหมาย
 *  2) รัน setup() เพื่อตรวจจับชีต แล้วรัน setPin() เพื่อตั้งรหัส PIN (รหัสไม่อยู่ในโค้ด)
 *  3) Deploy > New deployment > Web app > Execute as: Me > Access: Anyone
 *  4) แก้โค้ดทุกครั้ง ต้อง Deploy version ใหม่ (Manage deployments > Edit > New version)
 *************************************************************/

const SKIP_SHEETS = ['สรุป','Summary','รายงาน','แผนภูมิ','Chart','Dashboard','ช่องทาง','ประเภท'];
const STATUS_DONE = 'ยุติแล้ว';
const STATUS_PROG = 'อยู่ระหว่างดำเนินการ';

/* ====================== ROUTER ====================== */
function doGet(e){
  e = e || {};
  const p = e.parameter || {};
  const cb = p.callback || 'callback';
  let out;
  try{
    switch(p.action){
      case 'ping':   out = {ok:true, ...pingInfo_()}; break;
      case 'checkpin': out = verifyPin_(p.pin) ? {ok:true} : {ok:false, error:'PIN ไม่ถูกต้อง หรือถูกล็อกชั่วคราว'}; break;
      case 'all':    out = {ok:true, ...getAllData_()}; break;
      case 'list':   out = {ok:true, rows:listSheet_(p.sheet)}; break;
      case 'add':    out = writeAction_('add', p); break;
      case 'edit':   out = writeAction_('edit', p); break;
      case 'delete': out = writeAction_('delete', p); break;
      default:       out = {ok:false, error:'unknown action'};
    }
  }catch(err){ out = {ok:false, error:String(err)}; }
  return jsonp_(cb, out);
}

/* ====================== ตรวจจับชีต ====================== */
function classifySheets_(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const res = {districts:[], consumer:null};
  ss.getSheets().forEach(sh=>{
    const name = sh.getName();
    if(SKIP_SHEETS.some(s=>name.indexOf(s)>=0)) return;
    const map = headerMap_(sh);
    const has = h => map.hasOwnProperty(h);
    if(has('ชื่อเรื่อง') && has('การเร่งรัด')) res.districts.push(name);
    else if(has('ชื่อเรื่อง') && has('หมายเหตุ') && !has('การเร่งรัด')) res.consumer = name;
  });
  return res;
}

function headerMap_(sh){
  const lastCol = sh.getLastColumn(); if(lastCol<1) return {};
  const head = sh.getRange(1,1,1,lastCol).getValues()[0];
  const map = {};
  head.forEach((h,i)=>{ const k=String(h).trim(); if(k) map[k]=i+1; });
  return map;
}

function pingInfo_(){
  const c = classifySheets_();
  const sheets = [];
  c.districts.forEach(name=> sheets.push({name, type:'อำเภอ', count:countRows_(name)}));
  if(c.consumer) sheets.push({name:c.consumer, type:'คุ้มครองผู้บริโภค', count:countRows_(c.consumer)});
  return {sheets, districtCount:c.districts.length, hasConsumer:!!c.consumer};
}

function countRows_(name){
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); if(!sh) return 0;
  const map = headerMap_(sh); const tc = map['ชื่อเรื่อง']; if(!tc) return 0;
  const last = sh.getLastRow(); if(last<2) return 0;
  return sh.getRange(2,tc,last-1,1).getValues().filter(r=>String(r[0]).trim()).length;
}

/* ====================== READ ====================== */
function getAllData_(){
  const c = classifySheets_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const records = [];
  c.districts.forEach(name=>{
    const sh = ss.getSheetByName(name); const map = headerMap_(sh);
    rowsOf_(sh,map).forEach(g=>{
      if(!g('ชื่อเรื่อง')) return;
      records.push({
        district:name, no:g('ที่'), title:g('ชื่อเรื่อง'),
        complainant:g('ผู้ร้องเรียน'), accused:g('ผู้ถูกร้องเรียน'), type:g('ประเภท'),
        dateIn:fmtDate_(g('วันที่ร้องเรียน')), deadline:fmtDate_(g('กำหนดรายงาน')),
        detail:g('รายละเอียด'), channel:g('ช่องทาง'), agency:g('หน่วยงานรับผิดชอบ'),
        status:g('สถานะ'), urge:g('การเร่งรัด'), updatedAt:fmtDate_(g('อัปเดตล่าสุด'))
      });
    });
  });

  const consumer = [];
  if(c.consumer){
    const sh = ss.getSheetByName(c.consumer); const map = headerMap_(sh);
    rowsOf_(sh,map).forEach(g=>{
      if(!g('ชื่อเรื่อง')) return;
      consumer.push({
        title:g('ชื่อเรื่อง'), complainant:g('ผู้ร้องเรียน'), accused:g('ผู้ถูกร้องเรียน'),
        dateIn:fmtDate_(g('วันที่ร้องเรียน')), deadline:fmtDate_(g('กำหนดรายงาน')),
        detail:g('รายละเอียด'), status:g('สถานะ'), note:g('หมายเหตุ')
      });
    });
  }

  const summary = {
    total:records.length,
    done:records.filter(r=>r.status===STATUS_DONE).length,
    prog:records.filter(r=>r.status===STATUS_PROG).length,
    byDistrict:{}, byType:{}, byChannel:{}, sheets:pingInfo_().sheets
  };
  records.forEach(r=>{ add_(summary.byDistrict,r.district); add_(summary.byType,r.type); add_(summary.byChannel,r.channel); });
  return {records, consumer, summary, updated:nowStr_()};
}

function rowsOf_(sh,map){
  const last = sh.getLastRow(); if(last<2) return [];
  const lastCol = sh.getLastColumn();
  const data = sh.getRange(2,1,last-1,lastCol).getValues();
  return data.map(row => (h => { const c=map[h]; return c ? row[c-1] : ''; }));
}

function listSheet_(name){
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if(!sh) throw 'ไม่พบชีต: '+name;
  const map = headerMap_(sh);
  const last = sh.getLastRow(); if(last<2) return [];
  const lastCol = sh.getLastColumn();
  const data = sh.getRange(2,1,last-1,lastCol).getValues();
  const rows = [];
  data.forEach((row,i)=>{
    const tc = map['ชื่อเรื่อง']; if(!tc || !String(row[tc-1]).trim()) return;
    const o = {_row:i+2};
    Object.keys(map).forEach(h=>{
      const v = row[map[h]-1];
      o[h] = (h.indexOf('วันที่')>=0||h.indexOf('กำหนด')>=0) ? fmtDate_(v) : v;
    });
    rows.push(o);
  });
  return rows;
}

/* ====================== WRITE ====================== */
function writeAction_(mode,p){
  if(!verifyPin_(p.pin)) return {ok:false,error:'PIN ไม่ถูกต้อง'};
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(p.sheet);
  if(!sh) return {ok:false,error:'ไม่พบชีต: '+p.sheet};
  const map = headerMap_(sh);
  const lastCol = sh.getLastColumn();
  const titleCol = map['ชื่อเรื่อง']; if(!titleCol) return {ok:false,error:'ชีตนี้ไม่มีคอลัมน์ชื่อเรื่อง'};

  function buildRow(){
    const arr = new Array(lastCol).fill('');
    Object.keys(map).forEach(h=>{ if(h==='ที่') return; if(p[h]!==undefined) arr[map[h]-1]=p[h]; });
    if(map['อัปเดตล่าสุด']) arr[map['อัปเดตล่าสุด']-1] = nowStr_();  // ถ้ามีคอลัมน์นี้ จะบันทึกเวลาแก้ไขให้
    return arr;
  }

  if(mode==='add'){
    const r = nextRow_(sh,titleCol);
    sh.getRange(r,1,1,lastCol).setValues([buildRow()]);
    if(map['ที่']) renumber_(sh,map);
    return {ok:true,row:r};
  }
  if(mode==='edit'){
    const r = parseInt(p.row,10); if(!(r>=2)) return {ok:false,error:'เลขแถวไม่ถูกต้อง'};
    const arr = buildRow();
    if(map['ที่']) arr[map['ที่']-1] = sh.getRange(r,map['ที่']).getValue()||'';
    sh.getRange(r,1,1,lastCol).setValues([arr]);
    return {ok:true,row:r};
  }
  if(mode==='delete'){
    const r = parseInt(p.row,10); if(!(r>=2)) return {ok:false,error:'เลขแถวไม่ถูกต้อง'};
    sh.getRange(r,1,1,lastCol).clearContent();
    if(map['ที่']) renumber_(sh,map);
    return {ok:true,deleted:r};
  }
  return {ok:false,error:'mode ไม่ถูกต้อง'};
}

function nextRow_(sh,titleCol){
  const last = Math.max(sh.getLastRow(),1); if(last<2) return 2;
  const col = sh.getRange(2,titleCol,last-1,1).getValues();
  for(let i=0;i<col.length;i++){ if(!String(col[i][0]).trim()) return i+2; }
  return last+1;
}
function renumber_(sh,map){
  const noCol=map['ที่'], tCol=map['ชื่อเรื่อง'];
  const last=sh.getLastRow(); if(last<2) return;
  const titles=sh.getRange(2,tCol,last-1,1).getValues();
  let n=0; const out=titles.map(t=>String(t[0]).trim()?[++n]:['']);
  sh.getRange(2,noCol,last-1,1).setValues(out);
}

/* ====================== HELPERS ====================== */
function add_(obj,k){ if(!k) return; k=String(k).trim(); if(k) obj[k]=(obj[k]||0)+1; }
function fmtDate_(v){
  if(v instanceof Date) return v.getDate()+'/'+(v.getMonth()+1)+'/'+(v.getFullYear()+543);
  return v===undefined||v===null ? '' : String(v).trim();
}
function nowStr_(){
  const d=new Date();
  return Utilities.formatDate(d,'Asia/Bangkok','dd/MM/')+(d.getFullYear()+543)+' '+Utilities.formatDate(d,'Asia/Bangkok','HH:mm')+' น.';
}
function jsonp_(cb,obj){
  return ContentService.createTextOutput(cb+'('+JSON.stringify(obj)+')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
function verifyPin_(pin){
  if(!pin) return false;
  var props = PropertiesService.getScriptProperties();
  var stored = props.getProperty('PIN_HASH');
  if(!stored) return false;
  var lockUntil = Number(props.getProperty('PIN_LOCK_UNTIL')||0);
  if(lockUntil && Date.now() < lockUntil) return false;  // กำลังถูกล็อกจากเดารหัสผิด
  if(sha256_(String(pin)) === stored){
    props.deleteProperty('PIN_FAILS'); props.deleteProperty('PIN_LOCK_UNTIL');
    return true;
  }
  var fails = Number(props.getProperty('PIN_FAILS')||0) + 1;
  if(fails >= 5){ props.setProperty('PIN_LOCK_UNTIL', String(Date.now()+5*60*1000)); fails = 0; }
  props.setProperty('PIN_FAILS', String(fails));
  return false;
}
function sha256_(s){
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8)
    .map(b=>('0'+(b&0xFF).toString(16)).slice(-2)).join('');
}

/* ====================== SETUP ====================== */
// รันครั้งแรก: ตรวจจับชีต + เตือนให้ตั้ง PIN (ไม่มีรหัสอยู่ในโค้ด)
function setup(){
  const info = pingInfo_();
  let msg='ตรวจพบชีตข้อมูล:\n';
  info.sheets.forEach(s=> msg+=`• ${s.name} (${s.type}) — ${s.count} เรื่อง\n`);
  if(!info.sheets.length) msg+='⚠️ ไม่พบชีตที่มีหัวตารางถูกต้อง — ตรวจหัวตารางแถว 1 ให้มี "ชื่อเรื่อง" และ "การเร่งรัด"\n';
  const hasPin = !!PropertiesService.getScriptProperties().getProperty('PIN_HASH');
  msg += hasPin ? '\nสถานะ PIN: ตั้งค่าแล้ว ✓' : '\n⚠️ ยังไม่ได้ตั้ง PIN — ให้รันฟังก์ชัน setPin() หนึ่งครั้ง';
  msg += '\n\nอย่าลืม Deploy เป็น Web app';
  SpreadsheetApp.getUi().alert(msg);
}

// ตั้ง/เปลี่ยน PIN ผ่านกล่องกรอก — รหัสจะถูกเก็บเป็น hash ใน Script Properties
// ไม่มีรหัสปรากฏในซอร์สโค้ด รันฟังก์ชันนี้หนึ่งครั้งหลังวางโค้ด
function setPin(){
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('ตั้งรหัส PIN', 'กรอกรหัส PIN ที่ต้องการ (ตัวเลข):', ui.ButtonSet.OK_CANCEL);
  if(res.getSelectedButton() !== ui.Button.OK) return;
  const pin = (res.getResponseText()||'').trim();
  if(!pin){ ui.alert('ยกเลิก: ไม่ได้กรอกรหัส'); return; }
  PropertiesService.getScriptProperties().setProperty('PIN_HASH', sha256_(pin));
  ui.alert('ตั้งรหัส PIN เรียบร้อย ✓ (เก็บแบบเข้ารหัส ไม่แสดงในโค้ด)');
}

// ลบ PIN (ถ้าต้องการรีเซ็ต)
function clearPin(){
  PropertiesService.getScriptProperties().deleteProperty('PIN_HASH');
  SpreadsheetApp.getUi().alert('ลบรหัส PIN แล้ว — รัน setPin() เพื่อตั้งใหม่');
}

/* ====================== แจ้งเตือน / สำรองข้อมูล ====================== */
/* ตั้งอีเมลผู้รับก่อน (รันครั้งเดียว): แก้อีเมลแล้วรัน setAlertEmail */
function setAlertEmail(){
  var EMAIL = 'someone@example.com';   // <-- แก้เป็นอีเมลเจ้าหน้าที่ผู้รับแจ้งเตือน
  PropertiesService.getScriptProperties().setProperty('ALERT_EMAIL', EMAIL);
  SpreadsheetApp.getUi().alert('ตั้งอีเมลแจ้งเตือน: ' + EMAIL);
}

/* แจ้งเตือนเรื่องใกล้/เกินกำหนด — ตั้ง Trigger รายวัน (เวลา) ให้รันฟังก์ชันนี้ */
function dailyDeadlineAlert(){
  var email = PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL');
  if(!email) return;
  var data = getAllData_();
  var today = new Date(); today.setHours(0,0,0,0);
  var over = [], near = [];
  data.records.forEach(function(r){
    if(r.status === STATUS_DONE) return;
    var p = String(r.deadline).split('/'); if(p.length!==3) return;
    var dl = new Date(+p[2]-543, +p[1]-1, +p[0]);
    var diff = Math.round((dl - today)/86400000);
    if(diff < 0) over.push({r:r,d:diff});
    else if(diff <= 7) near.push({r:r,d:diff});
  });
  if(!over.length && !near.length) return;
  var html = '<h3>ศูนย์ดำรงธรรมหนองบัวลำภู — แจ้งเตือนเรื่องใกล้/เกินกำหนด</h3>';
  function block(title,arr,fmt){ if(!arr.length) return '';
    var s='<h4>'+title+' ('+arr.length+')</h4><ul>';
    arr.sort(function(a,b){return a.d-b.d;}).forEach(function(x){
      s+='<li><b>'+x.r.title+'</b> — '+x.r.district+' · '+(x.r.agency||'')+' · '+fmt(x.d)+'</li>';});
    return s+'</ul>';
  }
  html += block('🔴 เกินกำหนดแล้ว', over, function(d){return 'เกิน '+Math.abs(d)+' วัน';});
  html += block('🟠 ใกล้ครบกำหนด (ภายใน 7 วัน)', near, function(d){return 'อีก '+d+' วัน';});
  MailApp.sendEmail({to:email, subject:'[ดำรงธรรม นภ.] แจ้งเตือนเรื่องเร่งรัด '+nowStr_(), htmlBody:html});
}

/* สำรองข้อมูล: ก๊อปสเปรดชีตทั้งไฟล์ — ตั้ง Trigger รายสัปดาห์ให้รันฟังก์ชันนี้ */
function weeklyBackup(){
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = 'สำรอง_' + ss.getName() + '_' + Utilities.formatDate(new Date(),'Asia/Bangkok','yyyy-MM-dd');
  var file = DriveApp.getFileById(ss.getId()).makeCopy(name);
  // เก็บไว้ในโฟลเดอร์เดียวกับไฟล์ต้นฉบับ
  var parents = DriveApp.getFileById(ss.getId()).getParents();
  if(parents.hasNext()){ var folder = parents.next(); folder.addFile(file); DriveApp.getRootFolder().removeFile(file); }
}
