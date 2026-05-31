function canRefund(order) {
  return ["待接单", "已接单", "制作中", "已配送", "争议中"].includes(order.status);
}

function canDispute(order) {
  return ["已配送", "已完成"].includes(order.status);
}

module.exports = {
  canDispute,
  canRefund
};
