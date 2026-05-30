import express from 'express';
import Group from '../models/Group.js';
import auth from '../middlewares/auth.js';

const router = express.Router();

// [POST] /api/groups - 공구방 개설 (7주차 REST 원칙 및 11주차 JWT 검증 적용)
router.post('/', auth, async (req, res) => {
  try {
    const { title, item, targetPeople } = req.body;
    
    // 방을 만든 사람(req.user.id)을 첫 번째 참여자로 자동 등록합니다
    const newGroup = new Group({
      title,
      item,
      targetPeople,
      participants: [req.user.id]
    });

    await newGroup.save(); // DB에 저장 (10주차)
    res.status(201).json(newGroup);
  } catch (err) {
    res.status(400).json({ message: '방 개설 실패', error: err.message });
  }
});

// [GET] /api/groups - 현재 모집 중인 모든 공구방 목록 조회
router.get('/', async (req, res) => {
  try {
    const groups = await Group.find({ status: '모집중' }).sort({ createdAt: -1 });
    res.status(200).json(groups);
  } catch (err) {
    res.status(500).json({ message: '서버 오류 발생' });
  }
});

// [POST] /api/groups/:id/join - 특정 공구방 실시간 참여 (Socket.io 결합)
router.post('/:id/join', auth, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: '존재하지 않는 공구방입니다.' });
    if (group.status !== '모집중') return res.status(400).json({ message: '이미 마감된 공구방입니다.' });

    // 이미 참여한 유저인지 검사
    if (group.participants.includes(req.user.id)) {
      return res.status(400).json({ message: '이미 참여 중인 공구방입니다.' });
    }

    // 명단에 유저 추가
    group.participants.push(req.user.id);

    // 목표 인원이 다 찼는지 확인 후 상태 변경
    if (group.participants.length >= group.targetPeople) {
      group.status = '매칭완료';
    }

    await group.save();

    // [핵심] Express 앱에 등록된 Socket.io 객체를 가져와 실시간 알림을 보냅니다 (13주차)
    const io = req.app.get('io');
    const roomId = group._id.toString();

    // 해당 공구방(Room)에 접속해 있는 유저들에게 실시간 이벤트 브로드캐스팅
    io.to(roomId).emit('status_updated', {
      message: `새로운 멤버가 참여했습니다! 현재 인원 (${group.participants.length}/${group.targetPeople})`,
      group: group
    });

    res.status(200).json({ message: '공구 참여 성공', group });
  } catch (err) {
    res.status(500).json({ message: '서버 오류', error: err.message });
  }
});

export default router;