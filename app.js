import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import path from 'path';
import cors from 'cors';

// 라우터 모듈 가져오기 (2주차 ESM)
import authRoutes from './routes/auth.js';
import groupRoutes from './routes/group.js';
import Group from './models/Group.js';

const app = express();
const server = http.createServer(app);

// 실시간 양방향 통신을 위한 Socket.io 서버 초기화 (13주차)
const io = new Server(server, {
  cors: { origin: '*' }
});

app.set('io', io);

// 9주차 EJS 화면 엔진 설정 및 절대 경로 최적화
app.set('view engine', 'ejs');
app.set('views', path.join(process.cwd(), 'views'));

app.use(cors());
app.use(express.json());

// 가짜 토큰 발행 처리 (웹 화면에서 로그인 과정 없이 간편하게 테스트하기 위한 필수 미들웨어)
app.use((req, res, next) => {
  req.user = { id: new mongoose.Types.ObjectId().toString() };
  next();
});

// API 경로 연결 (7주차 REST API 명세 구현)
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);

// [5주차 + 9주차 SSR] 메인 화면 접속 시 데이터베이스 연동
app.get('/', async (req, res) => {
  try {
    // 10주차: MongoDB Atlas에서 실제 저장된 공구방 데이터를 최신순으로 긁어옵니다
    const groups = await Group.find().sort({ createdAt: -1 });
    res.render('index', { groups: groups });
  } catch (err) {
    console.error('메인 화면 렌더링 에러:', err);
    res.status(500).send('서버 내부 데이터 로딩 실패. 대시보드의 MONGO_URI를 확인하세요.');
  }
});

io.on('connection', (socket) => {
  socket.on('join_room', (roomId) => {
    socket.join(roomId);
  });
});

// [14주차 클라우드 환경 필수 설정] 
// Render.com은 포트 번호를 가변적으로 주입하므로 process.env.PORT가 무조건 최우선이어야 합니다!
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ 에러: 환경 변수에 MONGO_URI가 등록되지 않았습니다!');
}

// 10주차 비동기 연결 패턴 준수
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('🌱 MongoDB Atlas 클라우드 데이터베이스와 완전히 연결되었습니다!');
    server.listen(PORT, () => {
      console.log(`🚀 전 세계 라이브 서비스 가동 중! 포트 번호: ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ 데이터베이스 최종 도킹 실패:', err.message);
    // 주소가 잘못되어도 웹 서버 자체는 강제로 띄워 패닉 상태를 방지합니다
    server.listen(PORT, () => {
      console.log(`⚠️ DB 연결은 실패했으나, 런타임 크래시를 방지하기 위해 서버만 켜둡니다.`);
    });
  });

export default server;