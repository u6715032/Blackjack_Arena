import jwt from "jsonwebtoken";

export const cookieName = "blackjack_session";
export function publicUser(user) {
  return {
    id: String(user._id),
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
  };
}

export function createAuth(config, repository) {
  const cookieOptions = {
    httpOnly: true,
    secure: config.secureCookie,
    sameSite: "strict",
    path: "/",
  };
  function signIn(response, user) {
    const token = jwt.sign({ version: user.tokenVersion }, config.jwtSecret, {
      subject: String(user._id),
      expiresIn: "8h",
      algorithm: "HS256",
      issuer: "blackjack-arena",
      audience: "blackjack-web",
    });
    response.cookie(cookieName, token, {
      ...cookieOptions,
      maxAge: 8 * 60 * 60 * 1000,
    });
  }
  async function verifyToken(token) {
    try {
      const claims = jwt.verify(token || "", config.jwtSecret, {
        algorithms: ["HS256"],
        issuer: "blackjack-arena",
        audience: "blackjack-web",
      });
      const user = await repository.findUserById(claims.sub);
      if (!user || user.tokenVersion !== claims.version)
        throw new Error("Session revoked.");
      return user;
    } catch {
      const error = new Error("Please log in again.");
      error.status = 401;
      throw error;
    }
  }
  return {
    signIn,
    verifyToken,
    clear: (response) => response.clearCookie(cookieName, cookieOptions),
    async requireUser(request, response, next) {
      try {
        request.user = await verifyToken(request.cookies[cookieName]);
        next();
      } catch (error) {
        next(error);
      }
    },
  };
}
