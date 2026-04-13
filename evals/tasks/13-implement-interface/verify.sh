#!/bin/bash
node -e "
const { Circle, Rectangle } = require('./shapes.js');
if (!Circle || !Rectangle) process.exit(1);

const c = new Circle(5);
if (Math.abs(c.getArea() - Math.PI * 25) > 0.01) process.exit(1);
if (Math.abs(c.getPerimeter() - 2 * Math.PI * 5) > 0.01) process.exit(1);

const r = new Rectangle(3, 4);
if (r.getArea() !== 12) process.exit(1);
if (r.getPerimeter() !== 14) process.exit(1);
"
