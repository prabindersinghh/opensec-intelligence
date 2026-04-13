function process(data) {
  console.log('Processing: ' + data);
  return data.toUpperCase();
}

module.exports = { process };
