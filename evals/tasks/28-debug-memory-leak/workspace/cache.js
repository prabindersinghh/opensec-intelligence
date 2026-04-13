class Cache {
  constructor() {
    this.store = {};
  }
  
  get(key) {
    return this.store[key];
  }
  
  set(key, value) {
    this.store[key] = value;
  }
  
  has(key) {
    return key in this.store;
  }
  
  delete(key) {
    delete this.store[key];
  }
  
  get size() {
    return Object.keys(this.store).length;
  }
}

module.exports = { Cache };
