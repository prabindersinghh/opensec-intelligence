async function fetchAll(urls) {
  const results = [];
  for (const url of urls) {
    fetch(url).then(r => r.text()).then(t => results.push(t));
  }
  return results;
}
module.exports = { fetchAll };
