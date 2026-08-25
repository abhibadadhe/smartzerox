// ============================================
// EMAIL TEMPLATES FOR ACCOUNT RECOVERY
// ============================================

exports.accountUnlockTemplate = ({ name, unlockUrl, expiryMinutes, lockedUntil }) => `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
    .content { background: #f9f9f9; padding: 30px; }
    .button { display: inline-block; padding: 12px 30px; background: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .warning { background: #FEF3C7; border-left: 4px solid #F59E0B; padding: 15px; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔓 Account Unlock Request</h1>
    </div>
    <div class="content">
      <p>Hi ${name},</p>
      
      <p>Your account has been temporarily locked due to too many failed login attempts.</p>
      
      <div class="warning">
        <strong>⏰ Account Status:</strong><br>
        Your account is locked until: <strong>${lockedUntil}</strong>
      </div>
      
      <p>You can unlock your account immediately by clicking the button below:</p>
      
      <a href="${unlockUrl}" class="button">Unlock My Account</a>
      
      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #4F46E5;">${unlockUrl}</p>
      
      <p><strong>⚠️ Security Note:</strong></p>
      <ul>
        <li>This link will expire in ${expiryMinutes} minutes</li>
        <li>If you didn't request this, please ignore this email</li>
        <li>Your account will automatically unlock after the lockout period</li>
      </ul>
      
      <p>If you're having trouble accessing your account, please contact our support team.</p>
      
      <p>Best regards,<br>Smart Xerox Security Team</p>
    </div>
    <div class="footer">
      <p>This is an automated security email from Smart Xerox</p>
      <p>If you didn't request this, please contact support immediately</p>
    </div>
  </div>
</body>
</html>
`;

exports.passwordResetTemplate = ({ name, otp, resetUrl, expiryMinutes }) => `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
    .content { background: #f9f9f9; padding: 30px; }
    .otp-box { background: white; border: 2px dashed #4F46E5; padding: 20px; text-align: center; margin: 20px 0; }
    .otp-code { font-size: 32px; font-weight: bold; color: #4F46E5; letter-spacing: 5px; }
    .button { display: inline-block; padding: 12px 30px; background: #4F46E5; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .divider { text-align: center; margin: 30px 0; color: #999; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔑 Password Reset Request</h1>
    </div>
    <div class="content">
      <p>Hi ${name},</p>
      
      <p>We received a request to reset your password. Use the OTP code below to reset your password:</p>
      
      <div class="otp-box">
        <p style="margin: 0; color: #666;">Your OTP Code:</p>
        <div class="otp-code">${otp}</div>
        <p style="margin: 10px 0 0 0; color: #999; font-size: 14px;">Valid for ${expiryMinutes} minutes</p>
      </div>
      
      <div class="divider">
        <p>── OR ──</p>
      </div>
      
      <p>Click the button below to reset your password directly:</p>
      
      <a href="${resetUrl}" class="button">Reset Password</a>
      
      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #4F46E5;">${resetUrl}</p>
      
      <p><strong>⚠️ Security Note:</strong></p>
      <ul>
        <li>This OTP and link will expire in ${expiryMinutes} minutes</li>
        <li>If you didn't request this, please ignore this email</li>
        <li>Never share your OTP with anyone</li>
      </ul>
      
      <p>Best regards,<br>Smart Xerox Security Team</p>
    </div>
    <div class="footer">
      <p>This is an automated security email from Smart Xerox</p>
      <p>If you didn't request this, please contact support immediately</p>
    </div>
  </div>
</body>
</html>
`;

exports.passwordChangedTemplate = ({ name, changedAt }) => `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #10B981; color: white; padding: 20px; text-align: center; }
    .content { background: #f9f9f9; padding: 30px; }
    .success-box { background: #D1FAE5; border-left: 4px solid #10B981; padding: 15px; margin: 20px 0; }
    .warning { background: #FEE2E2; border-left: 4px solid #EF4444; padding: 15px; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ Password Changed Successfully</h1>
    </div>
    <div class="content">
      <p>Hi ${name},</p>
      
      <div class="success-box">
        <strong>✓ Your password has been changed successfully</strong><br>
        Changed at: ${changedAt}
      </div>
      
      <p>Your password was recently changed. You can now login with your new password.</p>
      
      <div class="warning">
        <strong>⚠️ Didn't make this change?</strong><br>
        If you didn't change your password, your account may be compromised. Please contact our support team immediately.
      </div>
      
      <p><strong>Security Tips:</strong></p>
      <ul>
        <li>Use a strong, unique password</li>
        <li>Don't share your password with anyone</li>
        <li>Enable two-factor authentication</li>
        <li>Change your password regularly</li>
      </ul>
      
      <p>Best regards,<br>Smart Xerox Security Team</p>
    </div>
    <div class="footer">
      <p>This is an automated security notification from Smart Xerox</p>
    </div>
  </div>
</body>
</html>
`;

exports.accountRecoveryTemplate = ({ name, recoveryUrl, reason, expiryMinutes }) => `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #EF4444; color: white; padding: 20px; text-align: center; }
    .content { background: #f9f9f9; padding: 30px; }
    .button { display: inline-block; padding: 12px 30px; background: #EF4444; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
    .warning { background: #FEE2E2; border-left: 4px solid #EF4444; padding: 15px; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🆘 Account Recovery Request</h1>
    </div>
    <div class="content">
      <p>Hi ${name},</p>
      
      <p>We received a request to recover your account.</p>
      
      <div class="warning">
        <strong>Reason:</strong> ${reason}
      </div>
      
      <p>Click the button below to recover your account:</p>
      
      <a href="${recoveryUrl}" class="button">Recover My Account</a>
      
      <p>Or copy and paste this link into your browser:</p>
      <p style="word-break: break-all; color: #EF4444;">${recoveryUrl}</p>
      
      <p><strong>What you can do:</strong></p>
      <ul>
        <li>Reset your password</li>
        <li>Change your email address</li>
        <li>Update your phone number</li>
        <li>Regain access to your account</li>
      </ul>
      
      <p><strong>⚠️ Security Note:</strong></p>
      <ul>
        <li>This link will expire in ${expiryMinutes} minutes</li>
        <li>If you didn't request this, please contact support immediately</li>
        <li>Your account may be compromised</li>
      </ul>
      
      <p>Best regards,<br>Smart Xerox Security Team</p>
    </div>
    <div class="footer">
      <p>This is an automated security email from Smart Xerox</p>
      <p>If you didn't request this, please contact support immediately</p>
    </div>
  </div>
</body>
</html>
`;

exports.accountRecoveredTemplate = ({ name, updatedFields, recoveredAt }) => `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #10B981; color: white; padding: 20px; text-align: center; }
    .content { background: #f9f9f9; padding: 30px; }
    .success-box { background: #D1FAE5; border-left: 4px solid #10B981; padding: 15px; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ Account Recovered Successfully</h1>
    </div>
    <div class="content">
      <p>Hi ${name},</p>
      
      <div class="success-box">
        <strong>✓ Your account has been recovered successfully</strong><br>
        Recovered at: ${recoveredAt}<br>
        Updated fields: ${updatedFields}
      </div>
      
      <p>You can now login with your new credentials.</p>
      
      <p><strong>What was updated:</strong></p>
      <ul>
        ${updatedFields.split(', ').map(field => `<li>${field.charAt(0).toUpperCase() + field.slice(1)}</li>`).join('')}
      </ul>
      
      <p><strong>Next Steps:</strong></p>
      <ul>
        <li>Login with your new credentials</li>
        <li>Verify your email/phone if changed</li>
        <li>Review your account security settings</li>
        <li>Enable two-factor authentication</li>
      </ul>
      
      <p>Best regards,<br>Smart Xerox Security Team</p>
    </div>
    <div class="footer">
      <p>This is an automated security notification from Smart Xerox</p>
    </div>
  </div>
</body>
</html>
`;

exports.emailChangeVerificationTemplate = ({ name, otp, expiryMinutes }) => `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #4F46E5; color: white; padding: 20px; text-align: center; }
    .content { background: #f9f9f9; padding: 30px; }
    .otp-box { background: white; border: 2px dashed #4F46E5; padding: 20px; text-align: center; margin: 20px 0; }
    .otp-code { font-size: 32px; font-weight: bold; color: #4F46E5; letter-spacing: 5px; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📧 Verify Email Change</h1>
    </div>
    <div class="content">
      <p>Hi ${name},</p>
      
      <p>We received a request to change your email address. Please verify this email address by entering the OTP code below:</p>
      
      <div class="otp-box">
        <p style="margin: 0; color: #666;">Your OTP Code:</p>
        <div class="otp-code">${otp}</div>
        <p style="margin: 10px 0 0 0; color: #999; font-size: 14px;">Valid for ${expiryMinutes} minutes</p>
      </div>
      
      <p><strong>⚠️ Security Note:</strong></p>
      <ul>
        <li>This OTP will expire in ${expiryMinutes} minutes</li>
        <li>If you didn't request this, please ignore this email</li>
        <li>Never share your OTP with anyone</li>
      </ul>
      
      <p>Best regards,<br>Smart Xerox Security Team</p>
    </div>
    <div class="footer">
      <p>This is an automated security email from Smart Xerox</p>
    </div>
  </div>
</body>
</html>
`;

exports.emailChangedTemplate = ({ name, newEmail, changedAt }) => `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #10B981; color: white; padding: 20px; text-align: center; }
    .content { background: #f9f9f9; padding: 30px; }
    .success-box { background: #D1FAE5; border-left: 4px solid #10B981; padding: 15px; margin: 20px 0; }
    .warning { background: #FEE2E2; border-left: 4px solid #EF4444; padding: 15px; margin: 20px 0; }
    .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✅ Email Address Changed</h1>
    </div>
    <div class="content">
      <p>Hi ${name},</p>
      
      <div class="success-box">
        <strong>✓ Your email address has been changed</strong><br>
        New email: ${newEmail}<br>
        Changed at: ${changedAt}
      </div>
      
      <p>This is a notification that your email address has been successfully changed.</p>
      
      <div class="warning">
        <strong>⚠️ Didn't make this change?</strong><br>
        If you didn't change your email address, your account may be compromised. Please contact our support team immediately.
      </div>
      
      <p>Best regards,<br>Smart Xerox Security Team</p>
    </div>
    <div class="footer">
      <p>This is an automated security notification from Smart Xerox</p>
      <p>This email was sent to your old email address as a security measure</p>
    </div>
  </div>
</body>
</html>
`;

module.exports = exports;
