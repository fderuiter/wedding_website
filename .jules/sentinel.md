## 2024-05-24 - Secure Password Storage and Comparison
**Vulnerability:** The admin login route used direct string comparison (or simple hashing) for the password, which is vulnerable to brute-force and timing attacks.
**Learning:** For password verification, simple hashing (like SHA-256) is insufficient due to speed. Timing attacks are also a risk with direct comparison.
**Prevention:** Use `bcrypt` for password storage and verification. It handles salting automatically and is computationally expensive, resisting brute-force attacks. It also performs constant-time comparison.
