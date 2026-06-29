const { v4: uuidv4 } = require('uuid');

function generateCourierId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'HPT-CUR-';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

function generateTrackingId() {
  const num = Math.floor(1000 + Math.random() * 9000);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const suffix = chars.charAt(Math.floor(Math.random() * chars.length)) + Math.floor(Math.random() * 10);
  return `HPT-${num}-${suffix}`;
}

function generateCustomerId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'HPT-CST-';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

module.exports = { generateCourierId, generateTrackingId, generateCustomerId };
