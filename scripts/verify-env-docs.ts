import fs from 'fs';
import path from 'path';

function verifyEnvDocs() {
  const envFilePath = path.join(process.cwd(), 'src/env.ts');
  const deploymentDocPath = path.join(process.cwd(), 'DEPLOYMENT.md');
  const envExamplePath = path.join(process.cwd(), '.env.example');

  if (!fs.existsSync(envFilePath)) {
    console.error(`❌ src/env.ts not found at ${envFilePath}`);
    process.exit(1);
  }

  const envFile = fs.readFileSync(envFilePath, 'utf-8');
  
  // Statically parse the Zod schema keys to avoid side effects
  const objectMatch = envFile.match(/const envSchema = z\.object\(\{([\s\S]*?)\}\);/);
  if (!objectMatch) {
    console.error('❌ Could not find envSchema in src/env.ts');
    process.exit(1);
  }

  const schemaBody = objectMatch[1];
  const keys = [];
  const lines = schemaBody.split('\n');
  
  for (const line of lines) {
    // Match standard zod object keys
    const keyMatch = line.match(/^\s*([A-Z_]+)\s*:/);
    if (keyMatch) {
      keys.push(keyMatch[1]);
    }
  }

  if (keys.length === 0) {
    console.error('❌ No environment variables found in src/env.ts schema');
    process.exit(1);
  }

  const deploymentDoc = fs.existsSync(deploymentDocPath) ? fs.readFileSync(deploymentDocPath, 'utf-8') : '';
  const envExample = fs.existsSync(envExamplePath) ? fs.readFileSync(envExamplePath, 'utf-8') : '';

  let failed = false;

  for (const key of keys) {
    if (!deploymentDoc.includes(key)) {
      console.error(`❌ Missing variable ${key} in DEPLOYMENT.md`);
      failed = true;
    }
    if (!envExample.includes(key)) {
      console.error(`❌ Missing variable ${key} in .env.example`);
      failed = true;
    }
  }

  if (failed) {
    console.error('\nDocumentation is out of sync with the environment schema in src/env.ts.');
    console.error('Please update DEPLOYMENT.md and/or .env.example to include the missing variables.');
    process.exit(1);
  } else {
    console.log('✅ Environment variable documentation is up to date.');
  }
}

verifyEnvDocs();
