/**
 * Seed script to create initial admin user
 * Run locally:  node scripts/seedAdmin.js
 * Run on Render: use Render Shell →  node scripts/seedAdmin.js
 *
 * Override defaults with env vars or CLI args:
 *   ADMIN_EMAIL=x@y.com ADMIN_PASSWORD=Secret123 node scripts/seedAdmin.js
 *   node scripts/seedAdmin.js --email x@y.com --password Secret123
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const email    = getArg('--email')    || process.env.ADMIN_EMAIL    || 'admin@smartxerox.com';
    const password = getArg('--password') || process.env.ADMIN_PASSWORD || 'Admin@123456';

    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      console.log('Admin user already exists:', existingAdmin.email);
      console.log('To reset password, delete the existing admin first or use the forgot-password flow.');
      process.exit(0);
    }

    const admin = await User.create({
      name: 'Super Admin',
      email,
      phone: '9999999999',
      password,
      role: 'admin',
      isEmailVerified: true,
      isPhoneVerified: true,
      isActive: true,
    });

    console.log('✅ Admin user created successfully!');
    console.log('Email:', admin.email);
    console.log('Password:', password);
    console.log('Role:', admin.role);
    console.log('\n⚠️  Please change the admin password immediately after first login!');

  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

seedAdmin();
