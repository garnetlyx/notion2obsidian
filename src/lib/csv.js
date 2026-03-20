import { join, dirname, basename } from "node:path";
import { mkdir } from "node:fs/promises";
import { statSync } from "node:fs";
import { Glob } from "bun";
import chalk from "chalk";
import { generateValidFrontmatter, getTagsFromPath } from "./frontmatter.js";

// ============================================================================
// CSV Database Processing
// ============================================================================

/**
 * Processes CSV database files and creates index pages
 * @param {string} targetDir - The directory to scan for CSV files
 * @returns {Array} - Array of processed CSV info
 */
export async function processCsvDatabases(targetDir) {
  const csvFiles = [];
  const csvGlob = new Glob('**/*.csv');

  for (const csvPath of csvGlob.scanSync(targetDir)) {
    const fullPath = join(targetDir, csvPath);

    try {
      const csvContent = await Bun.file(fullPath).text();
      const lines = csvContent.split('\n').filter(line => line.trim());

      if (lines.length < 2) continue; // Skip empty or header-only files

      // Parse CSV header
      const header = lines[0].replace(/^\uFEFF/, '').split(',').map(col => col.trim().replace(/"/g, ''));
      const rows = lines.slice(1).map(line => {
        // Simple CSV parsing (handles basic cases)
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim());
        return values;
      });

      // Extract database name from filename
      const fileName = basename(csvPath, '.csv');
      const databaseName = fileName.replace(/\s[0-9a-fA-F]{32}(_all)?$/, ''); // Remove hash

      csvFiles.push({
        path: fullPath,
        fileName,
        databaseName,
        header,
        rows,
        recordCount: rows.length
      });

    } catch (error) {
      console.warn(chalk.yellow(`Warning: Failed to process CSV ${csvPath}: ${error.message}`));
    }
  }

  return csvFiles;
}

/**
 * Creates a markdown index page for a CSV database
 * @param {Object} csvInfo - CSV file information
 * @param {string} targetDir - Target directory
 * @returns {string} - Generated markdown content
 */
export function generateDatabaseIndex(csvInfo, targetDir) {
  const { databaseName, header, rows, fileName } = csvInfo;
  const relativeCsvPath = `${databaseName}.csv`;

  let markdown = `# ${databaseName}\n\n`;
  markdown += `Database with ${rows.length} records.\n\n`;

  // Add CSV file link
  markdown += `**CSV File:** [[${relativeCsvPath}|Open in spreadsheet app]]\n\n`;

  // Create Dataview query to show all records
  markdown += `## All Records\n\n`;
  markdown += '```dataview\n';
  markdown += 'TABLE WITHOUT ID ';

  // Use first 5 columns for the table view
  const displayColumns = header.slice(0, 5);
  markdown += displayColumns.join(', ') + '\n';
  markdown += `FROM csv("${relativeCsvPath}")\n`;
  markdown += '```\n\n';

  // Look for corresponding directory with individual MD files
  const baseDir = dirname(csvInfo.path);
  const dbDir = join(baseDir, databaseName);

  try {
    statSync(dbDir);

    // Directory exists - reference the _data folder
    markdown += `## Individual Pages\n\n`;
    markdown += `Individual database pages are stored in [[${databaseName}/_data|${databaseName}/_data/]]\n\n`;
  } catch (error) {
    // No individual pages directory
  }

  return markdown;
}

/**
 * Creates a markdown index page for a CSV database using SQL Seal syntax
 * @param {Object} csvInfo - CSV file information
 * @param {string} targetDir - Target directory
 * @returns {string} - Generated markdown content
 */
export function generateSqlSealIndex(csvInfo, targetDir) {
  const { databaseName, header, rows, fileName } = csvInfo;
  const relativeCsvPath = `${databaseName}.csv`;

  // Create SQL-safe table name (lowercase, underscores, no spaces)
  const tableName = databaseName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  let markdown = `# ${databaseName}\n\n`;
  markdown += `Database with ${rows.length} records.\n\n`;

  // Add CSV file link
  markdown += `**CSV File:** [[${relativeCsvPath}|Open in spreadsheet app]]\n\n`;

  // Create SQL Seal query to show all records
  markdown += `## All Records\n\n`;
  markdown += '```sqlseal\n';
  markdown += `TABLE ${tableName} = file("${relativeCsvPath}")\n\n`;

  // Use first 5 columns for the table view
  const displayColumns = header.slice(0, 5);
  markdown += `SELECT ${displayColumns.join(', ')}\n`;
  markdown += `FROM ${tableName}\n`;
  markdown += '```\n\n';

  // Look for corresponding directory with individual MD files
  const baseDir = dirname(csvInfo.path);
  const dbDir = join(baseDir, databaseName);

  try {
    statSync(dbDir);

    // Directory exists - reference the _data folder
    markdown += `## Individual Pages\n\n`;
    markdown += `Individual database pages are stored in [[${databaseName}/_data|${databaseName}/_data/]]\n\n`;
  } catch (error) {
    // No individual pages directory
  }

  // Add example queries section
  markdown += `## Example Queries\n\n`;
  markdown += '```sqlseal\n';
  markdown += `-- Filter records\n`;
  markdown += `SELECT * FROM ${tableName}\n`;
  markdown += `WHERE ${displayColumns[0]} LIKE '%search%'\n\n`;

  markdown += `-- Sort by column\n`;
  markdown += `SELECT * FROM ${tableName}\n`;
  markdown += `ORDER BY ${displayColumns[0]} ASC\n\n`;

  markdown += `-- Count records\n`;
  markdown += `SELECT COUNT(*) as total FROM ${tableName}\n`;
  markdown += '```\n\n';

  return markdown;
}

/**
 * Creates individual markdown notes from CSV rows (Dataview mode)
 * @param {Object} csvInfo - CSV file information
 * @param {string} targetDir - Target directory (for tag generation)
 * @param {string} databasesDir - _databases subdirectory path (for CSV copy)
 * @returns {Array} - Array of created note file paths
 */
export async function createNotesFromCsvRows(csvInfo, targetDir, databasesDir) {
  const { databaseName, header, rows, fileName } = csvInfo;
  const createdNotes = [];

  // Create notes in the SAME directory as the CSV file, inside a _data subfolder
  // This preserves the directory hierarchy and matches .base file filter expectations
  const csvDir = dirname(csvInfo.path);
  const notesDir = join(csvDir, databaseName, '_data');
  await mkdir(notesDir, { recursive: true });

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Generate tags from the notes directory path (matches .base file filters)
    const tags = getTagsFromPath(join(notesDir, 'placeholder.md'), targetDir);

    // Create note content with frontmatter
    const frontmatter = {
      tags: tags,
      'database-source': `_databases/${fileName}`,
      'database-row': i + 1,
      published: false
    };

    // Extract title from first column or generate one
    let title = '';
    if (row[0] && row[0].trim()) {
      title = row[0].replace(/"/g, '').trim();
    } else {
      title = `${databaseName} Record ${i + 1}`;
    }

    frontmatter.title = title;
    header.forEach((column, idx) => {
      if (row[idx] && row[idx].trim()) {
        const value = row[idx].replace(/"/g, '').trim();
        // Convert to kebab case - preserve non-ASCII characters (like Chinese, Unicode)
        const key = column.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '');
        
        if (!key) return; // Skip if key is empty after processing

        // Special handling for common Notion database columns
        if (key === 'notion-id' || column === 'notion-id') {
          frontmatter['notion-id'] = value;
        } else if (key === 'status' || key === 'priority' || key === 'assignee' || key === 'owner') {
          frontmatter[key] = value;
        } else {
          frontmatter[key] = value;
        }
      }
    });

    // Generate clean filename
    const cleanTitle = title
      .replace(/[^a-zA-Z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-')            // Spaces to hyphens
      .toLowerCase()
      .slice(0, 50);                   // Limit length

    const noteFileName = `${cleanTitle || `record-${i + 1}`}.md`;
    const notePath = join(notesDir, noteFileName);

    // Generate markdown content
    let content = generateValidFrontmatter(frontmatter, '');
    content += `\n# ${title}\n\n`;

    // Add table with all properties
    content += '## Properties\n\n';
    content += '| Property | Value |\n';
    content += '| --- | --- |\n';

    header.forEach((column, idx) => {
      if (row[idx] && row[idx].trim()) {
        const value = row[idx].replace(/"/g, '').trim().replace(/\|/g, '\\|');
        content += `| ${column} | ${value} |\n`;
      }
    });

    content += `\n## Database Info\n\n`;
    content += `Source: [[${databaseName}_Index|${databaseName} Database]]\n`;
    content += `Record: ${i + 1} of ${rows.length}\n`;

    await Bun.write(notePath, content);
    createdNotes.push(notePath);
  }

  return createdNotes;
}

/**
 * Generates a Dataview-compatible database index page
 * @param {Object} csvInfo - CSV file information
 * @param {string} targetDir - Target directory
 * @param {Array} createdNotes - Array of created note paths
 * @returns {string} - Generated markdown content
 */
export function generateDataviewIndex(csvInfo, targetDir, createdNotes) {
  const { databaseName, header, rows, fileName } = csvInfo;

  let markdown = `# ${databaseName}\n\n`;
  markdown += `Database with ${rows.length} records converted to individual notes.\n\n`;

  // Add Dataview queries
  markdown += '## All Records\n\n';
  markdown += '```dataview\n';
  markdown += 'TABLE WITHOUT ID file.link as "Record", ';

  // Add common columns to the query
  const commonColumns = ['status', 'priority', 'assignee', 'owner', 'due'];
  const availableColumns = commonColumns.filter(col =>
    header.some(h => h.toLowerCase().includes(col))
  );

  if (availableColumns.length > 0) {
    markdown += availableColumns.join(', ') + '\n';
  } else {
    markdown += 'title\n';
  }

  markdown += `FROM #database/${databaseName.toLowerCase().replace(/\s+/g, '-')}\n`;
  markdown += '```\n\n';

  // Add filtered views
  if (availableColumns.includes('status')) {
    markdown += '## Active Records\n\n';
    markdown += '```dataview\n';
    markdown += 'TABLE WITHOUT ID file.link as "Record", status, priority\n';
    markdown += `FROM #database/${databaseName.toLowerCase().replace(/\s+/g, '-')}\n`;
    markdown += 'WHERE status != "Done" AND status != "Completed"\n';
    markdown += 'SORT priority DESC\n';
    markdown += '```\n\n';
  }

  // Add CSV source info
  markdown += '## CSV Data Source\n\n';
  markdown += `Raw CSV file: \`_databases/${fileName}.csv\`\n\n`;
  markdown += 'You can query the CSV directly with Dataview:\n\n';
  markdown += '```dataview\n';
  markdown += `TABLE WITHOUT ID ${header.slice(0, 3).join(', ')}\n`;
  markdown += `FROM csv("_databases/${fileName}.csv")\n`;
  markdown += '```\n\n';

  // Add individual note links
  markdown += `## Individual Notes (${createdNotes.length})\n\n`;
  createdNotes.slice(0, 10).forEach(notePath => {
    const noteName = basename(notePath, '.md');
    const displayName = noteName.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    markdown += `- [[${noteName}|${displayName}]]\n`;
  });

  if (createdNotes.length > 10) {
    markdown += `\n*Showing first 10 of ${createdNotes.length} notes. Use Dataview queries above to see all.*\n`;
  }

  return markdown;
}

// ============================================================================
// Obsidian Bases Support
// ============================================================================

/**
 * Generates an Obsidian Bases (.base) file from CSV data
 * @param {Object} csvInfo - CSV file information  
 * @param {string} targetDir - Target directory (for tag generation)
 * @returns {string} - Generated .base YAML content
 */
export function generateBaseFile(csvInfo, targetDir) {
  const { databaseName, header, rows, fileName } = csvInfo;
  
  // Detect column types for better property mapping
  const columnTypes = detectColumnTypes(header, rows);
  
  // Generate filter tags from the database notes directory path
  // Notes are stored in a subdirectory with the database name
  // We use the CSV file path + database name to get the full notes directory path
  const csvDir = dirname(csvInfo.path);
  const notesDirPath = join(csvDir, databaseName, 'placeholder.md');
  const tags = getTagsFromPath(notesDirPath, targetDir);
  
  // Build the base structure
  const base = {
    filters: generateBaseFilters(tags),
    properties: generateBaseProperties(header, columnTypes),
    formulas: generateBaseFormulas(header, columnTypes),
    views: generateBaseViews(header, columnTypes, databaseName)
  };
  
  // Convert to YAML
  return convertBaseToYaml(base);
}

/**
 * Detects the type of each column from sample data
 * @param {Array} header - Column headers
 * @param {Array} rows - Data rows
 * @returns {Object} - Map of column name to type
 */
function detectColumnTypes(header, rows) {
  const types = {};
  const sampleSize = Math.min(rows.length, 10);
  
  for (const col of header) {
    const colIndex = header.indexOf(col);
    const samples = rows.slice(0, sampleSize).map(r => r[colIndex]).filter(v => v && v.trim());
    
    if (samples.length === 0) {
      types[col] = 'text';
      continue;
    }
    
    // Check for dates
    const datePattern = /^\d{4}-\d{2}-\d{2}|^\d{2}\/\d{2}\/\d{4}/;
    if (samples.every(s => datePattern.test(s))) {
      types[col] = 'date';
      continue;
    }
    
    // Check for numbers
    if (samples.every(s => !isNaN(parseFloat(s)) && isFinite(s))) {
      types[col] = 'number';
      continue;
    }
    
    // Check for boolean
    const boolPattern = /^(true|false|yes|no)$/i;
    if (samples.every(s => boolPattern.test(s))) {
      types[col] = 'boolean';
      continue;
    }
    
    types[col] = 'text';
  }
  
  return types;
}

/**
 * Generates base filters for selecting database notes
 * @param {Array} tags - Tags from getTagsFromPath
 * @returns {Object} - Filter configuration
 */
function generateBaseFilters(tags) {
  // Build filter expressions - notes must have ALL the path-derived tags
  const tagFilters = tags.map(tag => `file.hasTag("${tag}")`);
  
  return {
    and: [
      ...tagFilters,
      'file.ext == "md"'
    ]
  };
}

/**
 * Generates properties configuration for each column
 * @param {Array} header - Column headers
 * @param {Object} types - Column type map
 * @returns {Object} - Properties configuration
 */
function generateBaseProperties(header, types) {
  const properties = {};
  
  for (const col of header) {
    const trimmedCol = col.trim();
    if (!trimmedCol) continue;
    
    // Convert to kebab case - preserve non-ASCII characters (like Chinese, Unicode)
    const key = trimmedCol.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '');
    if (key) {
      properties[key] = {
        displayName: trimmedCol
      };
    }
  }
  
  return properties;
}

/**
 * Generates useful formulas based on column types
 * @param {Array} header - Column headers
 * @param {Object} types - Column type map
 * @returns {Object} - Formulas configuration
 */
function generateBaseFormulas(header, types) {
  const formulas = {};
  
  // Look for date columns to create days_until/days_since formulas
  for (const col of header) {
    const key = col.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '');
    
    if (types[col] === 'date') {
      if (col.toLowerCase().includes('due') || col.toLowerCase().includes('deadline')) {
        formulas[`days_until_${key}`] = `if(${key}, (date(${key}) - today()).days, "")`;
        formulas[`is_overdue`] = `if(${key}, date(${key}) < today() && status != "done", false)`;
      } else if (col.toLowerCase().includes('created') || col.toLowerCase().includes('start')) {
        formulas[`days_since_${key}`] = `if(${key}, (today() - date(${key})).days, "")`;
      }
    }
  }
  
  return formulas;
}

/**
 * Generates views configuration for the base
 * @param {Array} header - Column headers
 * @param {Object} types - Column type map
 * @param {string} databaseName - Database name
 * @returns {Array} - Views configuration
 */
function generateBaseViews(header, types, databaseName) {
  const views = [];
  const displayColumns = header.slice(0, 7).filter(col => col.trim());
  
  // Convert column names to property keys
  const orderKeys = displayColumns.map(col => {
    const trimmedCol = col.trim();
    return trimmedCol.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '');
  });
  
  // Main table view with all records
  const mainView = {
    type: 'table',
    name: `All ${databaseName}`,
    order: ['file.name', ...orderKeys]
  };
  views.push(mainView);
  
  // Check for status column to create filtered views
  const statusCol = header.find(col => col.toLowerCase().includes('status'));
  if (statusCol) {
    const statusKey = statusCol.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '');
    
    views.push({
      type: 'table',
      name: 'Active',
      filters: {
        and: [
          `${statusKey} != "done"`,
          `${statusKey} != "completed"`,
          `${statusKey} != "archived"`
        ]
      },
      order: mainView.order
    });
  }
  
  // Check for due date column to create overdue view
  const dueCol = header.find(col => 
    col.toLowerCase().includes('due') || 
    col.toLowerCase().includes('deadline')
  );
  if (dueCol) {
    const dueKey = dueCol.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fa5-]/g, '');
    const priorityCol = header.find(col => col.toLowerCase().includes('priority'));
    const orderCols = ['file.name', dueKey];
    if (priorityCol) {
      orderCols.push(priorityCol.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u4e00-\u9fa5-]/g, ''));
    }
    
    views.push({
      type: 'table',
      name: 'Overdue',
      filters: {
        and: [
          `formula.is_overdue == true`
        ]
      },
      order: orderCols
    });
  }
  
  return views;
}

/**
 * Converts a base configuration object to YAML string
 * @param {Object} base - Base configuration
 * @returns {string} - YAML formatted string
 */
function convertBaseToYaml(base) {
  const lines = [];
  
  // Filters
  lines.push('filters:');
  lines.push('  and:');
  for (const filter of base.filters.and) {
    lines.push(`    - '${filter}'`);
  }
  lines.push('');
  
  // Formulas
  if (Object.keys(base.formulas).length > 0) {
    lines.push('formulas:');
    for (const [name, expr] of Object.entries(base.formulas)) {
      lines.push(`  ${name}: '${expr}'`);
    }
    lines.push('');
  }
  
  // Properties
  lines.push('properties:');
  for (const [key, config] of Object.entries(base.properties)) {
    lines.push(`  ${key}:`);
    const escapedName = config.displayName.replace(/"/g, '\\"');
    lines.push(`    displayName: "${escapedName}"`);
  }
  lines.push('');
  
  // Views
  lines.push('views:');
  for (const view of base.views) {
    lines.push('  - type: table');
    lines.push(`    name: "${view.name.replace(/"/g, '\\"')}"`);
    
    if (view.filters) {
      lines.push('    filters:');
      lines.push('      and:');
      for (const filter of view.filters.and) {
        lines.push(`        - '${filter}'`);
      }
    }
    
    lines.push('    order:');
    for (const col of view.order) {
      lines.push(`      - ${col}`);
    }
  }
  
  return lines.join('\n') + '\n';
}
