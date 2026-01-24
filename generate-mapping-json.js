/**
 * Generate questionnaire-mapping.json from questionnaire-mapping.js
 * 
 * Usage: node generate-mapping-json.js
 */

const fs = require('fs');
const path = require('path');

// Read the JS file
const jsPath = path.join(__dirname, 'questionnaire-mapping.js');
const jsContent = fs.readFileSync(jsPath, 'utf8');

// Extract the data by evaluating the JS (remove export keywords for Node compatibility)
const cleanContent = jsContent.replace(/export /g, '');
const extractData = new Function(cleanContent + '; return { QUESTION_CATEGORIES, QUESTION_MAPPINGS };');
const data = extractData();

// Create the JSON structure
const jsonData = {
    version: new Date().toISOString().split('T')[0],
    updated_at: new Date().toISOString(),
    categories: data.QUESTION_CATEGORIES,
    mappings: data.QUESTION_MAPPINGS
};

// Write the JSON file
const jsonPath = path.join(__dirname, 'questionnaire-mapping.json');
fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));

console.log(`Generated questionnaire-mapping.json with ${data.QUESTION_MAPPINGS.length} mappings`);
console.log(`Categories: ${Object.keys(data.QUESTION_CATEGORIES).join(', ')}`);
