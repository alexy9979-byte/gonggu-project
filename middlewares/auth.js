import jwt from 'jsonwebtoken';

export default (req, res, next) => {
  try {
    // 클라이언트가 보낸 헤더에서 토큰을 꺼냅니다
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: '인증 토큰이 없어 접근이 거부되었습니다.' });
    }

    // 토큰이 진짜인지 위조되었는지 검증합니다 (11주차)
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'SECRET_KEY');
    req.user = decoded; // 로그인한 유저의 정보를 다음 기능으로 넘겨줍니다
    next(); // 검사 통과! 다음 단계로 진행 (6주차)
  } catch (err) {
    return res.status(403).json({ message: '유효하지 않거나 만료된 토큰입니다.' });
  }
};