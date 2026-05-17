import type { ReconciliationResult } from '../../types/nits.js';
import type { Violation } from './violations.js';
import { type ModuleNode as ModuleGraphNode } from './graph-builder.js';

const R    = '\x1b[0m';
const BOLD = '\x1b[1m';

function fg(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

export const AYU = {
  fg:     fg(179, 177, 173),
  muted:  fg(138, 143, 152),
  dim:    fg(98,  106, 115),
  green:  fg(134, 179,   0),
  orange: fg(255, 143,  64),
  red:    fg(240, 113, 120),
  cyan:   fg( 57, 186, 230),
  lime:   fg(228, 242,  34),
} as const;

export function divider(): void {
  console.log(`  ${AYU.dim}${'─'.repeat(48)}${R}`);
}

export function sectionHeader(title: string, subtitle?: string): void {
  const sub = subtitle ? `  ${AYU.muted}(${subtitle})${R}` : '';
  console.log(`  ${AYU.fg}${title}${R}${sub}`);
}

export function blank(): void {
  console.log();
}

export interface CheckReportData {
  version:      string;
  projectName:  string;
  modules:      ModuleGraphNode[];
  violations:   Violation[];
  nitsResult:   ReconciliationResult | null;
  options: {
    verbose:      boolean;
    strict:       boolean;
    moduleFilter?: string;
    domain?:       string;  // v2.0.0 — siempre undefined en v1.x
  };
}

export function printCheckReport(data: CheckReportData): void {
  printHeader(data);
  divider();
  
  if (data.options.verbose) {
    printArchitectureWithIdentity(data);
  } else {
    printArchitectureSection(data);
  }
  
  printViolationDetails(data.violations);
  
  if (!data.options.verbose) {
    printIdentitySection(data.nitsResult, data.modules);
  }
  
  divider();
  printSummary(data);
  printNextStep(data);
}

export function printHeader(data: CheckReportData): void {
  console.log(`  ${AYU.dim}▸${R} ${AYU.fg}Nodulus${R} ${AYU.fg}${BOLD}v${data.version}${R}  ${AYU.dim}—  ${data.projectName}${R}`);
  blank();
}

export function printArchitectureSection(data: CheckReportData): void {
  sectionHeader('Architecture');
  
  for (const mod of data.modules) {
    const modViolations = data.violations.filter(v => v.module === mod.name);
    const hasCircular = modViolations.some(v => v.type === 'circular-dependency');
    const isNew = data.nitsResult?.newModules?.some(n => n.name === mod.name) || false;
    
    let icon: string;
    let status: string;
    
    if (hasCircular) {
      icon = `${AYU.red}✗${R}`;
      status = `${AYU.red}circular dep${R}`;
    } else if (modViolations.length > 0) {
      icon = `${AYU.orange}⚠${R}`;
      status = `${AYU.orange}${modViolations.length} violation${modViolations.length === 1 ? '' : 's'}${R}`;
    } else if (isNew) {
      icon = `${AYU.cyan}◈${R}`;
      status = `${AYU.cyan}new${R}`;
    } else {
      icon = `${AYU.green}✔${R}`;
      status = `${AYU.green}OK${R}`;
    }

    const paddedName = mod.name.padEnd(14, ' ');
    console.log(`  ${icon}  ${AYU.fg}${paddedName}${R} ${status}`);
  }
  
  blank();
}

export function printArchitectureWithIdentity(data: CheckReportData): void {
  sectionHeader('Architecture + Identity');

  for (const mod of data.modules) {
    const modViolations = data.violations.filter(v => v.module === mod.name);
    const hasCircular = modViolations.some(v => v.type === 'circular-dependency');
    const isNew = data.nitsResult?.newModules?.some(n => n.name === mod.name) || false;
    
    let icon: string;
    
    if (hasCircular) {
      icon = `${AYU.red}✗${R}`;
    } else if (modViolations.length > 0) {
      icon = `${AYU.orange}⚠${R}`;
    } else if (isNew) {
      icon = `${AYU.cyan}◈${R}`;
    } else {
      icon = `${AYU.green}✔${R}`;
    }

    const paddedName = mod.name.padEnd(14, ' ');
    const idStr = mod.id || 'unknown';
    const resolvedBy = isNew ? 'new' : (mod.resolvedBy || 'unknown');
    
    let methodColored: string;
    let hint = '';
    
    const idDisplay = `[${idStr}`.padEnd(14, ' ');
    
    if (resolvedBy === 'new' || resolvedBy === 'path') {
       methodColored = `${AYU.cyan}${resolvedBy}${R}`;
       hint = resolvedBy === 'new' ? `  ${AYU.dim}— .nodulus generated${R}` : '';
    } else if (resolvedBy === 'jaccard') {
       methodColored = `${AYU.orange}jaccard${R}`;
       hint = `  ${AYU.dim}— no .nodulus file${R}`;
    } else if (resolvedBy === 'shadow-file') {
       methodColored = `${AYU.green}shadow-file${R}`;
    } else {
       methodColored = `${AYU.dim}${resolvedBy}${R}`;
    }
    
    const methodLength = resolvedBy.length;
    const methodPad = ' '.repeat(Math.max(0, 11 - methodLength));
    
    console.log(`  ${icon}  ${AYU.fg}${paddedName}${R} ${AYU.dim}${idDisplay}${R} ${methodColored}${methodPad}${AYU.dim}]${R}${hint}`);
  }
  
  blank();
  
  sectionHeader('Identity legend');
  console.log(`  ${AYU.green}shadow-file${R}  ${AYU.dim}— resolved by .nodulus ID  (100% confidence)${R}`);
  console.log(`  ${AYU.orange}jaccard${R}      ${AYU.dim}— resolved by similarity   (heuristic)${R}`);
  console.log(`  ${AYU.cyan}path${R}         ${AYU.dim}— resolved by path match   (new or legacy)${R}`);
  blank();
}

export function printViolationDetails(violations: Violation[]): void {
  if (violations.length === 0) return;

  const modulesWithViolations = Array.from(new Set(violations.map(v => v.module)));

  for (const moduleName of modulesWithViolations) {
    console.log(`  ${AYU.muted}${moduleName}${R}`);
    const moduleViolations = violations.filter(v => v.module === moduleName);

    for (const v of moduleViolations) {
      const isError = v.type === 'circular-dependency';
      const icon = isError ? `${AYU.red}✗${R}` : `${AYU.orange}⚠${R}`;
      
      console.log(`    ${icon}  ${AYU.fg}${v.message}${R}`);
      
      if (isError && v.cycle) {
        console.log(`       ${AYU.dim}${v.cycle.join(' → ')}${R}`);
        console.log(`       ${AYU.dim}${v.suggestion}${R}`);
      } else if (v.location) {
        const fileBase = v.location.file.split(/[/\\]/).pop() || v.location.file;
        console.log(`       ${AYU.dim}${fileBase}:${v.location.line}  →  ${v.suggestion}${R}`);
      } else {
        console.log(`       ${AYU.dim}${v.suggestion}${R}`);
      }
    }
    blank();
  }
}

export function printIdentitySection(nitsResult: ReconciliationResult | null, _modules: ModuleGraphNode[]): void {
  if (!nitsResult) return;

  sectionHeader('Identity', 'NITS');
  
  const allRecords = [
    ...nitsResult.confirmed,
    ...nitsResult.moved.map(m => m.record),
    ...nitsResult.candidates.map(m => m.record),
    ...nitsResult.stale
  ];
  
  const byShadowFile = allRecords.filter(r => r.resolvedBy === 'shadow-file').length;
  const byJaccard    = allRecords.filter(r => r.resolvedBy === 'jaccard').length;
  const newModules   = nitsResult.newModules.length;

  if (byShadowFile > 0) {
    console.log(`  ${AYU.green}✔${R}  ${AYU.fg}${byShadowFile.toString().padEnd(3)} modules${R}   ${AYU.green}via shadow-file${R}`);
  }
  if (byJaccard > 0) {
    console.log(`  ${AYU.orange}⚠${R}  ${AYU.fg}${byJaccard.toString().padEnd(3)} modules${R}   ${AYU.orange}via jaccard${R}  ${AYU.dim}— run bootstrap to generate .nodulus${R}`);
  }
  if (newModules > 0) {
    console.log(`  ${AYU.cyan}◈${R}  ${AYU.fg}${newModules.toString().padEnd(3)} modules${R}   ${AYU.cyan}new${R} ${AYU.dim}— .nodulus generated${R}`);
  }
  
  blank();
}

export function printSummary(data: CheckReportData): void {
  sectionHeader('Summary');

  const totalModules = data.modules.length;
  const okModules = data.modules.filter(m => data.violations.filter(v => v.module === m.name).length === 0).length;
  const newModules = data.nitsResult?.newModules?.length || 0;
  
  const okDisplay = okModules > 0 ? `${okModules} ok` : '';
  const newDisplay = newModules > 0 ? `${newModules} new` : '';
  const modsSub = [okDisplay, newDisplay].filter(Boolean).join(', ');
  const modsSubStr = modsSub ? `(${modsSub})` : '';

  console.log(`    ${AYU.dim}modules${R}    ${AYU.fg}${totalModules.toString().padEnd(3)}${R} ${AYU.dim}${modsSubStr}${R}`);

  const totalViolations = data.violations.length;
  const errorViolations = data.violations.filter(v => v.type === 'circular-dependency').length;
  const warnViolations = totalViolations - errorViolations;
  
  const warnDisplay = warnViolations > 0 ? `${warnViolations} warn` : '';
  const errDisplay = errorViolations > 0 ? `${errorViolations} error` : '';
  const viosSub = [warnDisplay, errDisplay].filter(Boolean).join(', ');
  const viosSubStr = viosSub ? `(${viosSub})` : '';
  
  const vioColor = totalViolations > 0 ? AYU.red : AYU.green;
  
  console.log(`    ${AYU.dim}violations${R} ${vioColor}${totalViolations.toString().padEnd(3)}${R} ${AYU.dim}${viosSubStr}${R}`);

  if (data.nitsResult) {
    const missingShadow = data.modules.filter(m => {
      const isNew = data.nitsResult?.newModules?.some(n => n.name === m.name);
      return !isNew && m.resolvedBy !== 'shadow-file';
    }).length;
    
    let identityDisplay: string;
    if (missingShadow > 0) {
      identityDisplay = `${AYU.orange}⚠   ${missingShadow} missing .nodulus${R}`;
    } else {
      identityDisplay = `${AYU.green}✔   all modules tracked${R}`;
    }
    console.log(`    ${AYU.dim}identity${R}   ${identityDisplay}`);
  } else {
    console.log(`    ${AYU.dim}identity${R}   ${AYU.dim}— disabled${R}`);
  }
  
  blank();
}

export function printNextStep(data: CheckReportData): void {
  const hasJaccard = data.modules.some(m => m.resolvedBy === 'jaccard');
  
  if (!data.options.verbose && hasJaccard) {
    console.log(`  ${AYU.dim}run${R} ${AYU.lime}nodulus check --verbose${R} ${AYU.dim}to view IDs and resolution method${R}`);
  }
  
  if (data.violations.length > 0) {
    console.log(`  ${AYU.dim}exit 1 — violations found${R}`);
  } else {
    console.log(`  ${AYU.dim}exit 0 — no violations found${R}`);
  }
  blank();
}
