import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import User from '../models/User.js';

const router = express.Router();

// [POST] /api/auth/register - 회원가입 (7주차 원칙 준수)
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // 이미 가입된 이메일인지 확인
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: '이미 존재하는 이메일입니다.' });

    const newUser = new User({ email, password });
    await newUser.save(); // 14주차 테이블에 새 유저 도큐먼트 생성 (10주차)

    res.status(201).json({ message: '회원가입이 완료되었습니다.' });
  } catch (err) {
    res.status(500).json({ message: '서버 오류 발생', error: err.message });
  }
});

// [POST] /api/auth/login - 로그인 및 JWT 토큰 발급 (11주차)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: '가입되지 않은 이메일입니다.' });

    // 비밀번호가 맞는지 비교
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: '비밀번호가 일치하지 않습니다.' });

    // 맞다면 유저 ID를 담은 디지털 열쇠(JWT 토큰)를 발급합니다 (24시간 유효)
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'SECRET_KEY', { expiresIn: '24h' });

    res.status(200).json({ token, message: '로그인 성공!' });
  } catch (err) {
    res.status(500).json({ message: '서버 오류 발생' });
  }
});

export default router;