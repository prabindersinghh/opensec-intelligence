#!/usr/bin/env bash
set -euo pipefail

# Verifier sets cwd to workspace; WORKSPACE env var also available

# Verify all three files exist
[ -f store.js ] || { echo "store.js missing"; exit 1; }
[ -f routes.js ] || { echo "routes.js missing"; exit 1; }
[ -f server.js ] || { echo "server.js missing"; exit 1; }

node -e "
const store = require('./store.js');

// Test store CRUD operations
// Add item — accept many naming conventions
const addFn = store.add || store.create || store.createItem || store.addItem || store.insert;
if (!addFn) { console.error('store must export add/create/createItem/addItem/insert function'); process.exit(1); }
const item = addFn.call(store, { name: 'Widget', price: 9.99 });

if (!item) { console.error('add/create must return the created item'); process.exit(1); }
if (!item.id && item.id !== 0) { console.error('Added item must have an id'); process.exit(1); }
if (item.name !== 'Widget') { console.error('Item name mismatch'); process.exit(1); }

// Get all items
const getAllFn = store.getAll || store.list || store.findAll || store.getAllItems || store.listItems || store.all;
if (!getAllFn) { console.error('store must export getAll/list/findAll function'); process.exit(1); }
const getAll = getAllFn.call(store);
if (!getAll || !Array.isArray(getAll) || getAll.length < 1) {
  console.error('getAll/list must return array with items');
  process.exit(1);
}

// Get by id
const getFn = store.get || store.getById || store.find || store.getItem || store.findById || store.findItem;
if (!getFn) { console.error('store must export get/getById/find function'); process.exit(1); }
const getOne = getFn.call(store, item.id);
if (!getOne || getOne.name !== 'Widget') {
  console.error('get/getById must return the item by id');
  process.exit(1);
}

// Update item
const updateFn = store.update || store.updateItem || store.set || store.patch;
if (!updateFn) { console.error('store must export update function'); process.exit(1); }
const updated = updateFn.call(store, item.id, { name: 'Gadget', price: 19.99 });
if (!updated) { console.error('update must return updated item'); process.exit(1); }
if (updated.name !== 'Gadget') { console.error('Update failed'); process.exit(1); }

// Delete item
const deleteFn = store.remove || store.delete || store.deleteItem || store.removeItem || store.destroy;
if (!deleteFn) { console.error('store must export remove/delete function'); process.exit(1); }
const deleteResult = deleteFn.call(store, item.id);

const afterDelete = getAllFn.call(store);
if (afterDelete.length !== 0) { console.error('Item should be deleted'); process.exit(1); }

// Verify routes.js exports something
const routes = require('./routes.js');
if (typeof routes !== 'function' && typeof routes !== 'object') {
  console.error('routes.js must export a function or object');
  process.exit(1);
}

console.log('All REST API CRUD tests passed');
"
