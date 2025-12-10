## 2024-05-24 - Timing Attack Prevention in Admin Login
**Vulnerability:** The admin login route used a direct string comparison (`!==`) for the password, which is vulnerable to timing attacks.
**Learning:** Even low-risk applications like wedding websites benefit from standard security practices. Using `crypto.timingSafeEqual` is straightforward and eliminates this class of vulnerability.
**Prevention:** Always use constant-time comparison for sensitive secrets. Hashing both inputs (e.g., with SHA-256) ensures equal length buffers, making `timingSafeEqual` easy to use.
