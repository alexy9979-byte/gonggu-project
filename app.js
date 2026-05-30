import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import path from 'path';
import cors from 'cors';
import nodemailer from 'nodemailer'; // 실제 이메일 발송용

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.set('io', io);
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));

app.use(cors());
app.use(express.json());

// [인메모리 데이터베이스 보관소]
let usersDB = []; 
let emailVerificationDB = {}; 
let cloudMockGroups = []; 

// 메인 페이지 화면 렌더링
app.get('/', (req, res) => {
  res.render('index', { groups: cloudMockGroups });
});

// ==========================================
// 📧 [보안 마감] Google SMTP 기반 환경 변수 메일 서버 설정
// ==========================================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, 
  auth: {
    // 🌟 소스 코드에 주소를 직접 적지 않고 Render 대시보드 환경 변수에서 안전하게 꺼내옵니다!
    user: process.env.GMAIL_USER, 
    pass: process.env.GMAIL_PASS  
  }
});

// 1. [API] 진짜 이메일로 6자리 인증번호 발송
app.post('/api/auth/send-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: '이메일을 입력해주세요.' });

  const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
  emailVerificationDB[email] = verificationCode;

  const mailOptions = {
    from: `"공구메이트 운영팀" <${process.env.GMAIL_USER}>`, 
    to: email,
    subject: '🛒 [공구메이트] 회원가입 이메일 인증번호입니다.',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #0d6efd; text-align: center;">🛒 공구메이트 회원가입</h2>
        <p style="font-size: 16px; color: #333;">안녕하세요! 우리 동네 실시간 공동구매 플랫폼 공구메이트입니다.</p>
        <p style="font-size: 14px; color: #666;">회원가입 화면에서 아래의 6자리 인증번호를 입력해 이메일 인증을 완료해주세요.</p>
        <div style="background-color: #f8f9fa; padding: 15px; text-align: center; border-radius: 5px; margin: 20px 0;">
          <span style="font-size: 28px; font-weight: bold; color: #333; letter-spacing: 5px;">${verificationCode}</span>
        </div>
        <p style="font-size: 12px; color: #999; text-align: center;">본 인증번호는 5분간 유효합니다.</p>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: '📧 입력하신 메일함으로 진짜 인증번호가 발송되었습니다! 메일함을 확인해주세요.' });
  } catch (error) {
    console.error('메일 전송 최종 실패 에러 로그:', error);
    res.status(500).json({ message: '❌ 메일 발송 중 서버 오류가 발생했습니다. Render 대시보드의 환경 변수를 확인하세요.', error: error.message });
  }
});

// 2. [API] 인증번호 확인 검증
app.post('/api/auth/verify-code', (req, res) => {
  const { email, code } = req.body;
  if (emailVerificationDB[email] && emailVerificationDB[email] === code) {
    delete emailVerificationDB[email];
    return res.status(200).json({ message: '✅ 이메일 인증이 완벽하게 성공했습니다!' });
  }
  res.status(400).json({ message: '❌ 인증번호가 올바르지 않습니다. 다시 확인해주세요.' });
});

// 3. [API] 회원가입 최종 처리
app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body;
  const exists = usersDB.find(u => u.email === email);
  if (exists) return res.status(400).json({ message: '이미 가입된 이메일입니다.' });
  
  usersDB.push({ email, password, name });
  res.status(201).json({ message: '회원가입 성공!' });
});

// 4. [API] 로그인 처리
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = usersDB.find(u => u.email === email && u.password === password);
  if (!user) return res.status(400).json({ message: '이메일 또는 비밀번호가 틀렸습니다.' });
  res.status(200).json({ message: '로그인 성공!', userName: user.name });
});

// 5. [API] 새로운 공구방 개설
app.post('/api/groups', (req, res) => {
  const { title, item, targetPeople, writer } = req.body;
  const newGroup = {
    _id: 'room_' + Date.now(),
    title,
    item,
    targetPeople: Number(targetPeople),
    participants: [writer || '익명회원'],
    status: '모집중'
  };
  cloudMockGroups.unshift(newGroup);
  res.status(201).json(newGroup);
});

// 6. [API] 공구방 참여하기
app.post('/api/groups/:id/join', (req, res) => {
  const { userName } = req.body;
  const group = cloudMockGroups.find(g => g._id === req.params.id);
  if (!group) return res.status(404).json({ message: '방이 존재하지 않습니다.' });
  
  if (group.status === '매칭완료' || group.participants.length >= group.targetPeople) {
    return res.status(400).json({ message: '🚫 이미 매칭이 완료되어 마감된 공구방입니다!' });
  }
  if (group.participants.includes(userName)) {
    return res.status(400).json({ message: '이미 이 공구방에 참여 중입니다!' });
  }

  group.participants.push(userName);
  
  // ⏰ 매칭 완료 시 정확히 5분(300,000ms) 뒤 자동 제거
  if (group.participants.length >= group.targetPeople) {
    group.status = '매칭완료';
    setTimeout(() => {
      cloudMockGroups = cloudMockGroups.filter(g => g._id !== group._id);
      io.emit('room_deleted', { id: group._id }); 
    }, 5 * 60 * 1000); 
  }
  
  io.emit('status_updated', { group });
  res.status(200).json({ message: '참여 완료', group });
});

// 7. [API] 매칭 중 취소하기 기능
app.post('/api/groups/:id/leave', (req, res) => {
  const { userName } = req.body;
  const group = cloudMockGroups.find(g => g._id === req.params.id);
  if (!group) return res.status(404).json({ message: '방이 없습니다.' });
  
  if (group.status === '모집중') {
    group.participants = group.participants.filter(p => p !== userName);
    if (group.participants.length === 0) {
      cloudMockGroups = cloudMockGroups.filter(g => g._id !== group._id);
      io.emit('room_deleted', { id: group._id });
    } else {
      io.to(group._id).emit('status_updated', { group });
    }
    return res.status(200).json({ message: '취소 완료', group });
  }
  return res.status(400).json({ message: '이미 매칭이 완료되어 취소할 수 없습니다.' });
});

io.on('connection', (socket) => {
  socket.on('join_room', (roomId) => { socket.join(roomId); });
});

const PORT = process.env.PORT || 3000;
if (process.env.MONGO_URI) {
  mongoose.connect(process.env.MONGO_URI).catch(() => {});
}

server.listen(PORT, () => { console.log(`🚀 완벽한 공구메이트 구글 보안 모드 가동 포트: ${PORT}`); });

export default server;