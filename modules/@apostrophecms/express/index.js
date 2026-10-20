const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.APOS_SESSION_SECRET;

if (isProduction && !sessionSecret) {
  throw new Error('APOS_SESSION_SECRET must be set in production');
}

export default {
  options: {
    // So baseUrl can be autodetected when behind nginx
    trustProxy: true,
    session: {
      // Dev-only fallback; production requires APOS_SESSION_SECRET
      secret: sessionSecret || 'dev-only-insecure-secret'
    }
  }
};
