import dotenv from 'dotenv';
dotenv.config();

console.log('SUPABASE_URL:', process.env.SUPABASE_URL);
console.log('SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY);
console.log('REDIS_URL:', process.env.REDIS_URL);
console.log('Current working directory:', process.cwd());