const mongoose = require('mongoose');
const Order = require('./models/Order');
require('dotenv').config();

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/smartxerox';

async function queryLastOrder() {
  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');

    const lastOrder = await Order.findOne().sort({ createdAt: -1 });
    if (!lastOrder) {
      console.log('No orders found.');
      return;
    }

    console.log(`=== LAST ORDER DETAILS ===`);
    console.log(`Order Number: ${lastOrder.orderNumber}`);
    console.log(`Status: ${lastOrder.status}`);
    console.log(`Created At: ${lastOrder.createdAt}`);
    console.log(`Documents count: ${lastOrder.documents?.length}`);

    lastOrder.documents?.forEach((doc, idx) => {
      console.log(`\nDocument #${idx + 1}:`);
      console.log(`  Name: ${doc.originalName}`);
      console.log(`  MimeType: ${doc.mimeType}`);
      console.log(`  imageOptions:`, JSON.stringify(doc.imageOptions, null, 2));
    });

  } catch (err) {
    console.error('Error querying MongoDB:', err);
  } finally {
    await mongoose.disconnect();
  }
}

queryLastOrder();
