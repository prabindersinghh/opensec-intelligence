#!/bin/bash
set -euo pipefail

node -e "
const v = require('./validator.js');

// String validation
let r = v.string().min(2).max(10).validate('hello');
if (!r.valid) { console.error('valid string failed'); process.exit(1); }

r = v.string().min(2).validate('a');
if (r.valid) { console.error('short string should fail'); process.exit(1); }
if (!r.errors || r.errors.length === 0) { console.error('should have errors'); process.exit(1); }

// Number validation
r = v.number().min(0).max(100).validate(50);
if (!r.valid) { console.error('valid number failed'); process.exit(1); }

r = v.number().min(0).validate(-1);
if (r.valid) { console.error('negative should fail min(0)'); process.exit(1); }

// Type checking
r = v.string().validate(123);
if (r.valid) { console.error('number should fail string check'); process.exit(1); }

r = v.number().validate('hello');
if (r.valid) { console.error('string should fail number check'); process.exit(1); }

// Boolean
r = v.boolean().validate(true);
if (!r.valid) { console.error('boolean validation failed'); process.exit(1); }

// Object
const schema = v.object({
  name: v.string().min(1),
  age: v.number().min(0),
});

r = schema.validate({ name: 'Alice', age: 30 });
if (!r.valid) { console.error('valid object failed'); process.exit(1); }

r = schema.validate({ name: '', age: 30 });
if (r.valid) { console.error('empty name should fail'); process.exit(1); }

// Optional
r = v.string().optional().validate(undefined);
if (!r.valid) { console.error('optional undefined should pass'); process.exit(1); }

// Array
r = v.array(v.number()).validate([1, 2, 3]);
if (!r.valid) { console.error('valid array failed'); process.exit(1); }

r = v.array(v.number()).validate([1, 'two', 3]);
if (r.valid) { console.error('mixed array should fail'); process.exit(1); }
"
