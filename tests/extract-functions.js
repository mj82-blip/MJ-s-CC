/**
 * Extract and export all pure logic functions from index.html for testing.
 * This avoids needing a DOM — we re-declare the functions directly.
 */

/* ── Bank-specific variable-income haircut rules ── */
const BANK_RULES = {
    dbs:     { name: 'DBS / POSB',        haircut: 0.30, minYears: 2, note: '30% haircut on variable income; 2-year track record required.' },
    ocbc:    { name: 'OCBC',              haircut: 0.30, minYears: 2, note: '30% haircut; need 2 years of variable income history.' },
    uob:     { name: 'UOB',               haircut: 0.30, minYears: 2, note: '30% haircut on variable; 2-year track record.' },
    scb:     { name: 'Standard Chartered', haircut: 0.30, minYears: 2, note: '30% haircut on variable income; may accept 1 year for high earners.' },
    hsbc:    { name: 'HSBC',              haircut: 0.30, minYears: 2, note: '30% haircut; requires 2 years proof for variable component.' },
    maybank: { name: 'Maybank',           haircut: 0.40, minYears: 2, note: '40% haircut on variable income — stricter than MAS minimum.' }
};

/* ── LTV rules (MAS) ── */
function getLTV(outstandingLoans, loanType, ageTenureExceeds65) {
    if (loanType === 'hdb') {
        if (outstandingLoans > 0) return 0;
        return ageTenureExceeds65 ? 0.55 : 0.80;
    }
    if (outstandingLoans === 0) return ageTenureExceeds65 ? 0.55 : 0.75;
    if (outstandingLoans === 1) return ageTenureExceeds65 ? 0.25 : 0.45;
    return ageTenureExceeds65 ? 0.15 : 0.35;
}

/* ── Loan math ── */
function monthlyPayment(principal, annualRate, years) {
    const r = annualRate / 100 / 12;
    const n = years * 12;
    if (r === 0) return principal / n;
    return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}

function maxLoanFromPayment(maxMonthly, annualRate, years) {
    const r = annualRate / 100 / 12;
    const n = years * 12;
    if (r === 0) return maxMonthly * n;
    return maxMonthly * (Math.pow(1 + r, n) - 1) / (r * Math.pow(1 + r, n));
}

function fmt(num) {
    return 'SGD ' + Math.round(num).toLocaleString('en-SG');
}

function pct(num) {
    return (num * 100).toFixed(0) + '%';
}

/* ── Buyer's Stamp Duty (BSD) — Singapore scale ── */
const BSD_BRACKETS = [
    { limit: 180000, rate: 0.01 },
    { limit: 180000, rate: 0.02 },
    { limit: 640000, rate: 0.03 },
    { limit: 500000, rate: 0.04 },
    { limit: 1500000, rate: 0.05 },
    { limit: Infinity, rate: 0.06 }
];
function calcBSD(price) {
    let remaining = price, bsd = 0;
    for (const b of BSD_BRACKETS) {
        const taxable = Math.min(remaining, b.limit);
        bsd += taxable * b.rate;
        remaining -= taxable;
        if (remaining <= 0) break;
    }
    return bsd;
}

/* ── Debounce utility ── */
function debounce(fn, ms) {
    let timer;
    return function() { clearTimeout(timer); timer = setTimeout(fn, ms); };
}

/* ── Amortization schedule builder ── */
function buildAmortSchedule(principal, annualRate, tenureYears, rateChangeYear, newRate, prepayments) {
    const months = tenureYears * 12;
    let balance = principal;
    let r = annualRate / 100 / 12;
    let pmt = r === 0 ? principal / months : principal * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1);
    const schedule = [];
    let cumP = 0, cumI = 0;

    for (let m = 1; m <= months && balance > 0.01; m++) {
        if (rateChangeYear > 0 && m === rateChangeYear * 12 + 1) {
            r = newRate / 100 / 12;
            const remainingMonths = months - m + 1;
            pmt = r === 0 ? balance / remainingMonths : balance * r * Math.pow(1 + r, remainingMonths) / (Math.pow(1 + r, remainingMonths) - 1);
        }

        const interestPortion = balance * r;
        let principalPortion = Math.min(pmt - interestPortion, balance);
        balance -= principalPortion;

        for (const pp of prepayments) {
            if (m === pp.year * 12 && balance > 0) {
                const ppAmt = Math.min(pp.amount, balance);
                balance -= ppAmt;
                principalPortion += ppAmt;
                const remMonths = months - m;
                if (remMonths > 0 && balance > 0) {
                    pmt = r === 0 ? balance / remMonths : balance * r * Math.pow(1 + r, remMonths) / (Math.pow(1 + r, remMonths) - 1);
                }
            }
        }

        cumP += principalPortion;
        cumI += interestPortion;

        schedule.push({
            month: m,
            principalPaid: principalPortion,
            interestPaid: interestPortion,
            cumPrincipal: cumP,
            cumInterest: cumI,
            balance: Math.max(0, balance)
        });

        if (balance <= 0.01) break;
    }
    return schedule;
}

/* ── Scenario calculation (extracted, no DOM deps) ── */
function calcScenarioData(s, base) {
    const propertyPrice = parseFloat(s.propertyPrice) || 0;
    const rawTenure = parseFloat(s.tenure);
    const tenure = Math.min(Math.max(isNaN(rawTenure) ? 25 : rawTenure, 1), 30);
    const interestRate = parseFloat(s.interestRate) || 3.5;
    const outstandingLoans = parseInt(s.outstandingLoans);
    const propertyType = s.propertyType;
    const loanType = s.loanType;

    const stressRate = loanType === 'hdb' ? interestRate : Math.max(4.0, interestRate + 0.5);
    const tdsrCap = base.totalAssessedIncome * 0.55;
    const tdsrAvailable = Math.max(0, tdsrCap - base.totalDebt);
    const msrApplies = propertyType === 'hdb' || propertyType === 'ec';
    const msrCap = base.totalAssessedIncome * 0.30;
    const msrAvailable = Math.max(0, msrCap - base.totalDebt);
    const maxMonthly = msrApplies ? Math.min(tdsrAvailable, msrAvailable) : tdsrAvailable;

    const agePlusTenure = base.oldestAge + tenure;
    const exceeds65 = agePlusTenure > 65;
    const keepTenure = base.ageTenureMode === 'reduceLTV';
    const maxTenureFor65 = Math.max(1, 65 - base.oldestAge);
    const ltvNormal = getLTV(outstandingLoans, loanType, false);
    const ltvReduced = getLTV(outstandingLoans, loanType, true);
    let effectiveTenure = tenure;
    let ltvApplied;
    if (exceeds65) {
        if (keepTenure) { effectiveTenure = tenure; ltvApplied = ltvReduced; }
        else { effectiveTenure = maxTenureFor65; ltvApplied = ltvNormal; }
    } else { ltvApplied = ltvNormal; }

    const maxLoanAfford = maxLoanFromPayment(maxMonthly, stressRate, effectiveTenure);
    const maxLoanLTV = ltvApplied > 0 && propertyPrice > 0 ? propertyPrice * ltvApplied : Infinity;
    const maxLoan = propertyPrice > 0 ? Math.min(maxLoanAfford, maxLoanLTV) : maxLoanAfford;

    const downPayment = propertyPrice > 0 ? Math.max(0, propertyPrice - maxLoan) : 0;
    const bsd = propertyPrice > 0 ? calcBSD(propertyPrice) : 0;
    const actualMonthly = maxLoan > 0 ? monthlyPayment(maxLoan, interestRate, effectiveTenure) : 0;

    const tdsrUsed = base.totalAssessedIncome > 0 ? ((base.totalDebt + (maxLoan > 0 ? monthlyPayment(maxLoan, stressRate, effectiveTenure) : 0)) / base.totalAssessedIncome) * 100 : 0;
    const tdsrPct = Math.min(tdsrUsed, 100);

    const totalCashNeeded = downPayment + bsd;
    const mandatoryCashPct = loanType === 'hdb' ? (outstandingLoans === 0 ? 0 : 0.25) : (outstandingLoans === 0 ? 0.05 : 0.25);
    const mandatoryCash = propertyPrice > 0 ? propertyPrice * mandatoryCashPct : 0;
    const cpfUsable = propertyPrice > 0 ? Math.min(base.totalCPF, Math.max(0, downPayment - mandatoryCash)) : 0;
    const cashNeeded = Math.max(0, totalCashNeeded - cpfUsable);
    const cashPosition = base.totalCash - cashNeeded;

    const maxDPFromFunds = base.totalCash + base.totalCPF - bsd;
    const minLoanQuantum = propertyPrice > 0 ? Math.max(0, propertyPrice - Math.min(maxDPFromFunds, propertyPrice)) : 0;
    const maxLoanQuantum = maxLoanAfford;

    const monthlyRate = interestRate / 100 / 12;
    const loanForCalc = propertyPrice > 0 ? Math.min(maxLoan, propertyPrice * ltvApplied) : maxLoanAfford;
    const month1Interest = loanForCalc * monthlyRate;
    const month1Principal = actualMonthly - month1Interest;

    const totalRepayment = actualMonthly * effectiveTenure * 12;
    const totalInterest = totalRepayment - loanForCalc;

    let principalPaidY5 = 0;
    let balanceY5 = loanForCalc;
    for (let m = 0; m < Math.min(60, effectiveTenure * 12); m++) {
        const intPart = balanceY5 * monthlyRate;
        const prinPart = actualMonthly - intPart;
        principalPaidY5 += prinPart;
        balanceY5 -= prinPart;
    }
    const equityY5 = propertyPrice > 0 ? downPayment + principalPaidY5 : 0;
    const equityPctY5 = propertyPrice > 0 ? (equityY5 / propertyPrice) * 100 : 0;

    const oppCostMonthly = downPayment * 0.025 / 12;
    const breakEvenRent = month1Interest + oppCostMonthly + (propertyPrice * 0.005 / 12);

    let verdict, verdictClass;
    if (propertyPrice <= 0) { verdict = 'Enter a price'; verdictClass = 'verdict-yellow'; }
    else if (cashPosition < 0 || ltvApplied === 0) { verdict = 'Cannot Afford'; verdictClass = 'verdict-red'; }
    else if (tdsrPct > 50 || cashPosition < propertyPrice * 0.02) { verdict = 'Tight'; verdictClass = 'verdict-yellow'; }
    else { verdict = 'Affordable'; verdictClass = 'verdict-green'; }

    let barColor;
    if (tdsrPct <= 40) barColor = 'var(--success)';
    else if (tdsrPct <= 50) barColor = 'var(--warning)';
    else barColor = 'var(--danger)';

    return { propertyPrice, tenure, interestRate, outstandingLoans, propertyType, loanType, maxLoanAfford, ltvApplied, downPayment, bsd, totalCashNeeded, actualMonthly, maxLoan, tdsrPct, barColor, cashPosition, verdict, verdictClass, msrApplies, mandatoryCash, cpfUsable, cashNeeded, totalCash: base.totalCash, totalCPF: base.totalCPF, minLoanQuantum, maxLoanQuantum, month1Interest, month1Principal, totalInterest, totalRepayment, equityPctY5, equityY5, breakEvenRent, loanForCalc };
}

module.exports = {
    BANK_RULES,
    BSD_BRACKETS,
    getLTV,
    monthlyPayment,
    maxLoanFromPayment,
    fmt,
    pct,
    calcBSD,
    debounce,
    buildAmortSchedule,
    calcScenarioData
};
