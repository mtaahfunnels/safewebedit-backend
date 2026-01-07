/**
 * Google Sheets Service Account Integration
 * Handles reading/writing data from Google Sheets via service account
 *
 * Pattern: Same as nearmecalls google-calendar.ts implementation
 */

const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

// Path to service account credentials
const CREDENTIALS_PATH = path.join(__dirname, '../../.credentials/google-sheets-service-account.json');

/**
 * Get authenticated Google Sheets client
 */
function getSheetsClient() {
  // Verify credentials file exists
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      'Service account credentials not found. Please create .credentials/google-sheets-service-account.json'
    );
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets', // Full read/write access
    ],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  return sheets;
}

/**
 * Extract spreadsheet ID from Google Sheets URL
 *
 * Supports formats:
 * - https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
 * - https://docs.google.com/spreadsheets/d/SPREADSHEET_ID
 *
 * @param {string} url - Google Sheets URL
 * @returns {string|null} Spreadsheet ID or null if invalid
 */
function extractSpreadsheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

/**
 * Test if service account has access to a spreadsheet
 *
 * @param {string} spreadsheetId - The spreadsheet ID
 * @returns {Object} { success: boolean, error?: string, title?: string }
 */
async function testAccess(spreadsheetId) {
  try {
    const sheets = getSheetsClient();

    const response = await sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId,
      fields: 'properties.title',
    });

    console.log('[Google Sheets] Access verified:', response.data.properties.title);

    return {
      success: true,
      title: response.data.properties.title,
      message: 'Access granted successfully',
    };
  } catch (error) {
    console.error('[Google Sheets] Access test failed:', error.message);

    // Provide helpful error messages
    if (error.message.includes('403') || error.message.includes('Permission denied')) {
      return {
        success: false,
        error: 'Permission denied. Please share the spreadsheet with the service account email.',
        helpText: 'Click "Share" in Google Sheets and add: safewebedit-sync-bot@safewebedit-sync.iam.gserviceaccount.com with "Editor" permission',
      };
    }

    if (error.message.includes('404')) {
      return {
        success: false,
        error: 'Spreadsheet not found. Please check the URL.',
      };
    }

    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Read data from a Google Sheet
 *
 * @param {string} spreadsheetId - The spreadsheet ID
 * @param {string} range - Range in A1 notation (e.g., 'Sheet1!A1:D10' or 'Sheet1!A:Z')
 * @returns {Object} { success: boolean, values?: Array[], range?: string, error?: string }
 */
async function readSheet(spreadsheetId, range = 'Sheet1!A:Z') {
  try {
    const sheets = getSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId,
      range: range,
      valueRenderOption: 'UNFORMATTED_VALUE', // Get actual values, not formatted strings
      dateTimeRenderOption: 'FORMATTED_STRING', // Dates as readable strings
    });

    const values = response.data.values || [];

    console.log('[Google Sheets] Read successful:', values.length, 'rows');

    return {
      success: true,
      values: values,
      range: response.data.range,
      rowCount: values.length,
    };
  } catch (error) {
    console.error('[Google Sheets] Read error:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Write data to a Google Sheet
 *
 * @param {string} spreadsheetId - The spreadsheet ID
 * @param {string} range - Range in A1 notation (e.g., 'Sheet1!A1')
 * @param {Array[]} values - 2D array of values to write
 * @param {string} valueInputOption - 'RAW' or 'USER_ENTERED' (default: RAW)
 * @returns {Object} { success: boolean, updatedCells?: number, error?: string }
 */
async function writeSheet(spreadsheetId, range, values, valueInputOption = 'RAW') {
  try {
    const sheets = getSheetsClient();

    const response = await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheetId,
      range: range,
      valueInputOption: valueInputOption,
      requestBody: {
        values: values,
      },
    });

    console.log('[Google Sheets] Write successful:', response.data.updatedCells, 'cells updated');

    return {
      success: true,
      updatedCells: response.data.updatedCells,
      updatedRange: response.data.updatedRange,
    };
  } catch (error) {
    console.error('[Google Sheets] Write error:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Append data to the end of a Google Sheet
 * Useful for adding new rows without overwriting existing data
 *
 * @param {string} spreadsheetId - The spreadsheet ID
 * @param {string} range - Range to append to (e.g., 'Sheet1!A:Z')
 * @param {Array[]} values - 2D array of values to append
 * @returns {Object} { success: boolean, updatedCells?: number, error?: string }
 */
async function appendToSheet(spreadsheetId, range, values) {
  try {
    const sheets = getSheetsClient();

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: spreadsheetId,
      range: range,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: values,
      },
    });

    console.log('[Google Sheets] Append successful:', response.data.updates.updatedCells, 'cells added');

    return {
      success: true,
      updatedCells: response.data.updates.updatedCells,
      updatedRange: response.data.updates.updatedRange,
    };
  } catch (error) {
    console.error('[Google Sheets] Append error:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get all sheet names (tabs) in a spreadsheet
 *
 * @param {string} spreadsheetId - The spreadsheet ID
 * @returns {Object} { success: boolean, sheets?: Array, error?: string }
 */
async function getSheetNames(spreadsheetId) {
  try {
    const sheetsClient = getSheetsClient();

    const response = await sheetsClient.spreadsheets.get({
      spreadsheetId: spreadsheetId,
      fields: 'sheets.properties.title',
    });

    const sheetNames = response.data.sheets.map(sheet => sheet.properties.title);

    console.log('[Google Sheets] Found sheets:', sheetNames);

    return {
      success: true,
      sheets: sheetNames,
    };
  } catch (error) {
    console.error('[Google Sheets] Error getting sheet names:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Parse spreadsheet data into structured format
 * Assumes first row is headers
 *
 * @param {Array[]} values - Raw spreadsheet values
 * @returns {Object[]} Array of objects with headers as keys
 */
function parseSpreadsheetData(values) {
  if (!values || values.length === 0) {
    return [];
  }

  const headers = values[0];
  const rows = values.slice(1);

  return rows.map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index] !== undefined ? row[index] : '';
    });
    return obj;
  });
}

module.exports = {
  getSheetsClient,
  extractSpreadsheetId,
  testAccess,
  readSheet,
  writeSheet,
  appendToSheet,
  getSheetNames,
  parseSpreadsheetData,
};
