module.exports = async (req, res) => {
  res.json({
    status: 'healthy',
    service: 'playwright-dashboard',
    timestamp: new Date().toISOString()
  });
};
