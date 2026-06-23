const bcrypt = require('bcrypt');

const password = process.argv[2];

if (!password) {
  console.error('Please provide a password as an argument.');
  process.exit(1);
}

const saltRounds = 10;

bcrypt.hash(password, saltRounds, function(err, hash) {
  if (err) {
    console.error('Error hashing password:', err);
    process.exit(1);
  }
  console.log(hash);
});
