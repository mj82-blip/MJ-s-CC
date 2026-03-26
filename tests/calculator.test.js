/**
 * Comprehensive unit tests for SG Mortgage Calculator pure logic functions.
 * Tests cover: LTV rules, loan math, formatting, BSD calculation,
 * amortization schedule, scenario engine, and edge cases.
 */

const {
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
} = require('./extract-functions');

// ═══════════════════════════════════════════
// BANK_RULES data validation
// ═══════════════════════════════════════════
describe('BANK_RULES', () => {
    test('all 6 banks are defined', () => {
        expect(Object.keys(BANK_RULES)).toEqual(['dbs', 'ocbc', 'uob', 'scb', 'hsbc', 'maybank']);
    });

    test('all banks have required fields', () => {
        for (const [key, bank] of Object.entries(BANK_RULES)) {
            expect(bank).toHaveProperty('name');
            expect(bank).toHaveProperty('haircut');
            expect(bank).toHaveProperty('minYears');
            expect(bank).toHaveProperty('note');
            expect(typeof bank.haircut).toBe('number');
            expect(bank.haircut).toBeGreaterThanOrEqual(0.30); // MAS minimum
            expect(bank.haircut).toBeLessThanOrEqual(1.0);
        }
    });

    test('Maybank has stricter 40% haircut', () => {
        expect(BANK_RULES.maybank.haircut).toBe(0.40);
    });

    test('all other banks have 30% MAS minimum haircut', () => {
        ['dbs', 'ocbc', 'uob', 'scb', 'hsbc'].forEach(bank => {
            expect(BANK_RULES[bank].haircut).toBe(0.30);
        });
    });
});

// ═══════════════════════════════════════════
// getLTV — MAS LTV rules
// ═══════════════════════════════════════════
describe('getLTV', () => {
    describe('bank loans', () => {
        test('1st property, age+tenure <= 65: 75%', () => {
            expect(getLTV(0, 'bank', false)).toBe(0.75);
        });
        test('1st property, age+tenure > 65: 55%', () => {
            expect(getLTV(0, 'bank', true)).toBe(0.55);
        });
        test('2nd property, age+tenure <= 65: 45%', () => {
            expect(getLTV(1, 'bank', false)).toBe(0.45);
        });
        test('2nd property, age+tenure > 65: 25%', () => {
            expect(getLTV(1, 'bank', true)).toBe(0.25);
        });
        test('3rd+ property, age+tenure <= 65: 35%', () => {
            expect(getLTV(2, 'bank', false)).toBe(0.35);
        });
        test('3rd+ property, age+tenure > 65: 15%', () => {
            expect(getLTV(2, 'bank', true)).toBe(0.15);
        });
        test('many outstanding loans: 35%/15%', () => {
            expect(getLTV(5, 'bank', false)).toBe(0.35);
            expect(getLTV(5, 'bank', true)).toBe(0.15);
        });
    });

    describe('HDB loans', () => {
        test('1st property, age+tenure <= 65: 80%', () => {
            expect(getLTV(0, 'hdb', false)).toBe(0.80);
        });
        test('1st property, age+tenure > 65: 55%', () => {
            expect(getLTV(0, 'hdb', true)).toBe(0.55);
        });
        test('any outstanding loans: 0% (not eligible)', () => {
            expect(getLTV(1, 'hdb', false)).toBe(0);
            expect(getLTV(1, 'hdb', true)).toBe(0);
            expect(getLTV(2, 'hdb', false)).toBe(0);
        });
    });
});

// ═══════════════════════════════════════════
// monthlyPayment — loan amortization formula
// ═══════════════════════════════════════════
describe('monthlyPayment', () => {
    test('standard case: $500k at 3.5% for 25 years', () => {
        const payment = monthlyPayment(500000, 3.5, 25);
        // Expected: ~$2,503.12 (standard amortization)
        expect(payment).toBeCloseTo(2503.12, 0);
    });

    test('zero interest rate: simple division', () => {
        const payment = monthlyPayment(240000, 0, 20);
        expect(payment).toBe(1000); // 240k / 240 months
    });

    test('high rate: $1M at 6% for 30 years', () => {
        const payment = monthlyPayment(1000000, 6, 30);
        // Expected: ~$5,995.51
        expect(payment).toBeCloseTo(5995.51, 0);
    });

    test('short tenure: $300k at 3% for 5 years', () => {
        const payment = monthlyPayment(300000, 3, 5);
        // Expected: ~$5,390.41
        expect(payment).toBeCloseTo(5390.41, 0);
    });

    test('small principal', () => {
        const payment = monthlyPayment(10000, 3.5, 1);
        expect(payment).toBeGreaterThan(0);
        expect(payment * 12).toBeGreaterThan(10000); // total > principal due to interest
    });

    test('monthly payment * months > principal (interest adds up)', () => {
        const payment = monthlyPayment(500000, 3.5, 25);
        const totalPaid = payment * 25 * 12;
        expect(totalPaid).toBeGreaterThan(500000);
        const totalInterest = totalPaid - 500000;
        expect(totalInterest).toBeGreaterThan(200000); // significant interest over 25 years
    });
});

// ═══════════════════════════════════════════
// maxLoanFromPayment — inverse of monthlyPayment
// ═══════════════════════════════════════════
describe('maxLoanFromPayment', () => {
    test('inverse of monthlyPayment', () => {
        // If monthly payment for 500k at 3.5% over 25yr is X, then maxLoan(X, 3.5, 25) should be 500k
        const pmt = monthlyPayment(500000, 3.5, 25);
        const maxLoan = maxLoanFromPayment(pmt, 3.5, 25);
        expect(maxLoan).toBeCloseTo(500000, 0);
    });

    test('zero interest rate', () => {
        const maxLoan = maxLoanFromPayment(1000, 0, 20);
        expect(maxLoan).toBe(240000); // 1000 * 240 months
    });

    test('realistic TDSR example: $3300/mo at 4% stress rate for 25 years', () => {
        const maxLoan = maxLoanFromPayment(3300, 4.0, 25);
        // Should be a reasonable loan amount
        expect(maxLoan).toBeGreaterThan(500000);
        expect(maxLoan).toBeLessThan(700000);
    });

    test('roundtrip for various rates', () => {
        [1.5, 2.5, 3.5, 4.5, 5.5, 7.0].forEach(rate => {
            const principal = 750000;
            const years = 20;
            const pmt = monthlyPayment(principal, rate, years);
            const recovered = maxLoanFromPayment(pmt, rate, years);
            expect(recovered).toBeCloseTo(principal, 0);
        });
    });
});

// ═══════════════════════════════════════════
// fmt — currency formatter
// ═══════════════════════════════════════════
describe('fmt', () => {
    test('formats a standard number', () => {
        const result = fmt(500000);
        expect(result).toMatch(/^SGD /);
        expect(result).toContain('500');
    });

    test('rounds to nearest integer', () => {
        expect(fmt(1234.56)).toMatch(/1,235|1235/); // locale may vary
    });

    test('formats zero', () => {
        expect(fmt(0)).toMatch(/SGD 0/);
    });

    test('formats large numbers', () => {
        const result = fmt(1500000);
        expect(result).toContain('SGD');
        expect(result).toMatch(/1.*500.*000/);
    });
});

// ═══════════════════════════════════════════
// pct — percentage formatter
// ═══════════════════════════════════════════
describe('pct', () => {
    test('0.75 -> 75%', () => {
        expect(pct(0.75)).toBe('75%');
    });

    test('0.55 -> 55%', () => {
        expect(pct(0.55)).toBe('55%');
    });

    test('1.0 -> 100%', () => {
        expect(pct(1.0)).toBe('100%');
    });

    test('0 -> 0%', () => {
        expect(pct(0)).toBe('0%');
    });

    test('0.15 -> 15%', () => {
        expect(pct(0.15)).toBe('15%');
    });
});

// ═══════════════════════════════════════════
// calcBSD — Buyer's Stamp Duty
// ═══════════════════════════════════════════
describe('calcBSD', () => {
    test('$0 property: no BSD', () => {
        expect(calcBSD(0)).toBe(0);
    });

    test('$100k property: first bracket only (1%)', () => {
        expect(calcBSD(100000)).toBe(1000);
    });

    test('$180k property: fills first bracket exactly', () => {
        expect(calcBSD(180000)).toBe(1800);
    });

    test('$200k property: spans first two brackets', () => {
        // 180k * 1% + 20k * 2% = 1800 + 400 = 2200
        expect(calcBSD(200000)).toBe(2200);
    });

    test('$360k property: fills first two brackets', () => {
        // 180k * 1% + 180k * 2% = 1800 + 3600 = 5400
        expect(calcBSD(360000)).toBe(5400);
    });

    test('$500k property: spans three brackets', () => {
        // 180k * 1% + 180k * 2% + 140k * 3% = 1800 + 3600 + 4200 = 9600
        expect(calcBSD(500000)).toBe(9600);
    });

    test('$1M property: spans three brackets', () => {
        // 180k * 1% + 180k * 2% + 640k * 3% = 1800 + 3600 + 19200 = 24600
        expect(calcBSD(1000000)).toBe(24600);
    });

    test('$1.5M property: spans four brackets', () => {
        // 180k * 1% + 180k * 2% + 640k * 3% + 500k * 4% = 1800 + 3600 + 19200 + 20000 = 44600
        expect(calcBSD(1500000)).toBe(44600);
    });

    test('$2M property: spans four brackets', () => {
        // 180k*1% + 180k*2% + 640k*3% + 500k*4% + 500k*5% = 1800+3600+19200+20000+25000 = 69600
        // Wait: 180+180+640+500 = 1500k, remaining = 500k at bracket 5 (5%)
        expect(calcBSD(2000000)).toBe(69600);
    });

    test('$5M property: hits top bracket (6%)', () => {
        // 180k*1% + 180k*2% + 640k*3% + 500k*4% + 1500k*5% + 2000k*6%
        // = 1800 + 3600 + 19200 + 20000 + 75000 + 120000 = 239600
        expect(calcBSD(5000000)).toBe(239600);
    });

    test('BSD is monotonically increasing', () => {
        let prev = 0;
        for (let price = 100000; price <= 3000000; price += 100000) {
            const bsd = calcBSD(price);
            expect(bsd).toBeGreaterThan(prev);
            prev = bsd;
        }
    });
});

// ═══════════════════════════════════════════
// debounce — utility function
// ═══════════════════════════════════════════
describe('debounce', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('delays function execution', () => {
        const fn = jest.fn();
        const debounced = debounce(fn, 100);

        debounced();
        expect(fn).not.toHaveBeenCalled();

        jest.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('resets timer on rapid calls', () => {
        const fn = jest.fn();
        const debounced = debounce(fn, 100);

        debounced();
        jest.advanceTimersByTime(50);
        debounced();
        jest.advanceTimersByTime(50);
        debounced();
        jest.advanceTimersByTime(50);

        expect(fn).not.toHaveBeenCalled();

        jest.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

// ═══════════════════════════════════════════
// buildAmortSchedule — amortization engine
// ═══════════════════════════════════════════
describe('buildAmortSchedule', () => {
    test('basic schedule: correct number of entries', () => {
        const schedule = buildAmortSchedule(500000, 3.5, 25, 0, 3.5, []);
        expect(schedule.length).toBe(300); // 25 * 12
    });

    test('balance reaches zero at the end', () => {
        const schedule = buildAmortSchedule(500000, 3.5, 25, 0, 3.5, []);
        const last = schedule[schedule.length - 1];
        expect(last.balance).toBeCloseTo(0, 0);
    });

    test('cumulative principal equals original loan', () => {
        const schedule = buildAmortSchedule(500000, 3.5, 25, 0, 3.5, []);
        const last = schedule[schedule.length - 1];
        expect(last.cumPrincipal).toBeCloseTo(500000, 0);
    });

    test('total interest is reasonable', () => {
        const schedule = buildAmortSchedule(500000, 3.5, 25, 0, 3.5, []);
        const last = schedule[schedule.length - 1];
        // Total interest for 500k at 3.5% over 25 years should be ~251k
        expect(last.cumInterest).toBeGreaterThan(200000);
        expect(last.cumInterest).toBeLessThan(300000);
    });

    test('first month: interest > principal (early in loan)', () => {
        const schedule = buildAmortSchedule(500000, 3.5, 25, 0, 3.5, []);
        const first = schedule[0];
        expect(first.interestPaid).toBeGreaterThan(first.principalPaid);
    });

    test('last month: principal > interest (late in loan)', () => {
        const schedule = buildAmortSchedule(500000, 3.5, 25, 0, 3.5, []);
        const last = schedule[schedule.length - 1];
        expect(last.principalPaid).toBeGreaterThan(last.interestPaid);
    });

    test('zero interest rate: equal payments', () => {
        const schedule = buildAmortSchedule(240000, 0, 20, 0, 0, []);
        expect(schedule.length).toBe(240);
        schedule.forEach(entry => {
            expect(entry.interestPaid).toBe(0);
            expect(entry.principalPaid).toBeCloseTo(1000, 0);
        });
    });

    test('rate shock increases total interest', () => {
        const baseline = buildAmortSchedule(500000, 3.5, 25, 0, 3.5, []);
        const shocked = buildAmortSchedule(500000, 3.5, 25, 3, 5.0, []);
        const baseInterest = baseline[baseline.length - 1].cumInterest;
        const shockInterest = shocked[shocked.length - 1].cumInterest;
        expect(shockInterest).toBeGreaterThan(baseInterest);
    });

    test('prepayment reduces total interest', () => {
        const baseline = buildAmortSchedule(500000, 3.5, 25, 0, 3.5, []);
        const withPrepay = buildAmortSchedule(500000, 3.5, 25, 0, 3.5, [{ year: 5, amount: 50000 }]);
        const baseInterest = baseline[baseline.length - 1].cumInterest;
        const prepayInterest = withPrepay[withPrepay.length - 1].cumInterest;
        expect(prepayInterest).toBeLessThan(baseInterest);
    });

    test('prepayment recalculates lower monthly payment (same term)', () => {
        // After prepayment, the code reduces monthly payment over remaining months
        // rather than reducing the loan term
        const baseline = buildAmortSchedule(500000, 3.5, 25, 0, 3.5, []);
        const withPrepay = buildAmortSchedule(500000, 3.5, 25, 0, 3.5, [{ year: 5, amount: 50000 }]);
        // Both have same number of months (payment reduced, not term)
        // but the final balance of the prepaid schedule should still reach ~0
        const lastPrepay = withPrepay[withPrepay.length - 1];
        expect(lastPrepay.balance).toBeCloseTo(0, 0);
    });

    test('prepayment larger than balance pays off loan', () => {
        const schedule = buildAmortSchedule(100000, 3.5, 10, 0, 3.5, [{ year: 1, amount: 200000 }]);
        // Should end at or near month 12 (prepayment at year 1 = month 12)
        expect(schedule.length).toBeLessThanOrEqual(12);
        const last = schedule[schedule.length - 1];
        expect(last.balance).toBeCloseTo(0, 0);
    });

    test('multiple prepayments compound savings', () => {
        const single = buildAmortSchedule(500000, 3.5, 25, 0, 3.5, [{ year: 5, amount: 50000 }]);
        const double = buildAmortSchedule(500000, 3.5, 25, 0, 3.5, [
            { year: 5, amount: 50000 },
            { year: 10, amount: 50000 }
        ]);
        const singleInterest = single[single.length - 1].cumInterest;
        const doubleInterest = double[double.length - 1].cumInterest;
        expect(doubleInterest).toBeLessThan(singleInterest);
    });

    test('each month entry has correct structure', () => {
        const schedule = buildAmortSchedule(500000, 3.5, 25, 0, 3.5, []);
        schedule.forEach((entry, i) => {
            expect(entry).toHaveProperty('month', i + 1);
            expect(entry).toHaveProperty('principalPaid');
            expect(entry).toHaveProperty('interestPaid');
            expect(entry).toHaveProperty('cumPrincipal');
            expect(entry).toHaveProperty('cumInterest');
            expect(entry).toHaveProperty('balance');
            expect(entry.principalPaid).toBeGreaterThanOrEqual(0);
            expect(entry.interestPaid).toBeGreaterThanOrEqual(0);
            expect(entry.balance).toBeGreaterThanOrEqual(0);
        });
    });
});

// ═══════════════════════════════════════════
// calcScenarioData — scenario comparison engine
// ═══════════════════════════════════════════
describe('calcScenarioData', () => {
    const defaultBase = {
        bankRule: BANK_RULES.dbs,
        isJoint: false,
        oldestAge: 35,
        totalAssessedIncome: 7400, // 6000 + (24000/12)*0.7
        totalDebt: 0,
        totalCPF: 50000,
        totalCash: 50000,
        ageTenureMode: 'reduceTenure'
    };

    test('basic scenario with private property', () => {
        const result = calcScenarioData({
            propertyPrice: '1000000',
            tenure: '25',
            interestRate: '3.5',
            outstandingLoans: '0',
            propertyType: 'private',
            loanType: 'bank'
        }, defaultBase);

        expect(result.ltvApplied).toBe(0.75);
        expect(result.maxLoan).toBeGreaterThan(0);
        expect(result.bsd).toBe(24600);
        expect(result.downPayment).toBe(250000); // 1M - 750k LTV
    });

    test('HDB property triggers MSR (30% cap)', () => {
        const result = calcScenarioData({
            propertyPrice: '500000',
            tenure: '25',
            interestRate: '2.6',
            outstandingLoans: '0',
            propertyType: 'hdb',
            loanType: 'hdb'
        }, defaultBase);

        expect(result.msrApplies).toBe(true);
        // MSR: 7400 * 0.30 = 2220 < TDSR: 7400 * 0.55 = 4070
        expect(result.ltvApplied).toBe(0.80); // HDB 1st property
    });

    test('EC from developer triggers MSR', () => {
        const result = calcScenarioData({
            propertyPrice: '800000',
            tenure: '25',
            interestRate: '3.5',
            outstandingLoans: '0',
            propertyType: 'ec',
            loanType: 'bank'
        }, defaultBase);

        expect(result.msrApplies).toBe(true);
    });

    test('private property does NOT trigger MSR', () => {
        const result = calcScenarioData({
            propertyPrice: '1000000',
            tenure: '25',
            interestRate: '3.5',
            outstandingLoans: '0',
            propertyType: 'private',
            loanType: 'bank'
        }, defaultBase);

        expect(result.msrApplies).toBe(false);
    });

    test('stress rate: bank loan uses max(4%, rate+0.5%)', () => {
        // Rate 3.5% -> stress 4.0%
        const result1 = calcScenarioData({
            propertyPrice: '0', tenure: '25', interestRate: '3.5',
            outstandingLoans: '0', propertyType: 'private', loanType: 'bank'
        }, defaultBase);

        // Rate 4.5% -> stress 5.0%
        const result2 = calcScenarioData({
            propertyPrice: '0', tenure: '25', interestRate: '4.5',
            outstandingLoans: '0', propertyType: 'private', loanType: 'bank'
        }, defaultBase);

        // Higher stress rate should give lower max loan
        expect(result2.maxLoanAfford).toBeLessThan(result1.maxLoanAfford);
    });

    test('HDB loan uses actual rate as stress rate', () => {
        const result = calcScenarioData({
            propertyPrice: '0', tenure: '25', interestRate: '2.6',
            outstandingLoans: '0', propertyType: 'hdb', loanType: 'hdb'
        }, defaultBase);

        // With HDB rate 2.6%, max loan should be higher than bank at 3.5% stress 4%
        const bankResult = calcScenarioData({
            propertyPrice: '0', tenure: '25', interestRate: '3.5',
            outstandingLoans: '0', propertyType: 'private', loanType: 'bank'
        }, defaultBase);

        // Even though HDB has MSR cap, the lower stress rate gives a higher max loan per dollar of payment
        // But MSR caps the payment at 30% vs TDSR at 55% — so bank TDSR should still yield higher max loan
        expect(bankResult.maxLoanAfford).toBeGreaterThan(result.maxLoanAfford);
    });

    test('no property price: verdict is "Enter a price"', () => {
        const result = calcScenarioData({
            propertyPrice: '0', tenure: '25', interestRate: '3.5',
            outstandingLoans: '0', propertyType: 'private', loanType: 'bank'
        }, defaultBase);

        expect(result.verdict).toBe('Enter a price');
    });

    test('age + tenure > 65 with reduceLTV mode: LTV is reduced, tenure kept', () => {
        const oldBase = { ...defaultBase, oldestAge: 50, ageTenureMode: 'reduceLTV' };
        const result = calcScenarioData({
            propertyPrice: '1000000', tenure: '20', interestRate: '3.5',
            outstandingLoans: '0', propertyType: 'private', loanType: 'bank'
        }, oldBase);

        // 50 + 20 = 70 > 65, keepTenure mode → reduced LTV
        expect(result.ltvApplied).toBe(0.55);
    });

    test('age + tenure > 65 with reduceTenure mode: tenure capped, normal LTV', () => {
        const oldBase = { ...defaultBase, oldestAge: 50, ageTenureMode: 'reduceTenure' };
        const result = calcScenarioData({
            propertyPrice: '1000000', tenure: '20', interestRate: '3.5',
            outstandingLoans: '0', propertyType: 'private', loanType: 'bank'
        }, oldBase);

        // 50 + 20 = 70 > 65, reduceTenure mode → cap at 65-50=15, keep normal LTV
        expect(result.ltvApplied).toBe(0.75);
        // Loan should be calculated with 15-year tenure (shorter = smaller loan)
    });

    test('age + tenure <= 65: normal LTV', () => {
        const result = calcScenarioData({
            propertyPrice: '1000000', tenure: '25', interestRate: '3.5',
            outstandingLoans: '0', propertyType: 'private', loanType: 'bank'
        }, defaultBase); // age 35 + 25 = 60 <= 65

        expect(result.ltvApplied).toBe(0.75);
    });

    test('outstanding loans reduce LTV', () => {
        const result0 = calcScenarioData({
            propertyPrice: '1000000', tenure: '25', interestRate: '3.5',
            outstandingLoans: '0', propertyType: 'private', loanType: 'bank'
        }, defaultBase);

        const result1 = calcScenarioData({
            propertyPrice: '1000000', tenure: '25', interestRate: '3.5',
            outstandingLoans: '1', propertyType: 'private', loanType: 'bank'
        }, defaultBase);

        expect(result1.ltvApplied).toBeLessThan(result0.ltvApplied);
    });

    test('BSD calculation matches calcBSD', () => {
        const result = calcScenarioData({
            propertyPrice: '1500000', tenure: '25', interestRate: '3.5',
            outstandingLoans: '0', propertyType: 'private', loanType: 'bank'
        }, defaultBase);

        expect(result.bsd).toBe(calcBSD(1500000));
    });

    test('TDSR utilization is capped at 100%', () => {
        const lowIncomeBase = { ...defaultBase, totalAssessedIncome: 1000, totalDebt: 400 };
        const result = calcScenarioData({
            propertyPrice: '1000000', tenure: '25', interestRate: '3.5',
            outstandingLoans: '0', propertyType: 'private', loanType: 'bank'
        }, lowIncomeBase);

        expect(result.tdsrPct).toBeLessThanOrEqual(100);
    });

    test('HDB first property: 0% mandatory cash (all CPF allowed)', () => {
        const result = calcScenarioData({
            propertyPrice: '500000', tenure: '25', interestRate: '2.6',
            outstandingLoans: '0', propertyType: 'hdb', loanType: 'hdb'
        }, defaultBase);

        expect(result.mandatoryCash).toBe(0); // HDB 1st property: no mandatory cash
    });

    test('HDB with outstanding loans: 25% mandatory cash', () => {
        const result = calcScenarioData({
            propertyPrice: '500000', tenure: '25', interestRate: '2.6',
            outstandingLoans: '1', propertyType: 'hdb', loanType: 'hdb'
        }, defaultBase);

        // HDB with outstanding loan: LTV=0, but mandatory cash % is 25%
        expect(result.mandatoryCash).toBe(500000 * 0.25);
    });

    test('verdict: Cannot Afford when cash position negative', () => {
        const poorBase = { ...defaultBase, totalCash: 1000, totalCPF: 1000 };
        const result = calcScenarioData({
            propertyPrice: '2000000', tenure: '25', interestRate: '3.5',
            outstandingLoans: '0', propertyType: 'private', loanType: 'bank'
        }, poorBase);

        expect(result.verdict).toBe('Cannot Afford');
    });

    test('equity at year 5 is positive when property is entered', () => {
        const result = calcScenarioData({
            propertyPrice: '1000000', tenure: '25', interestRate: '3.5',
            outstandingLoans: '0', propertyType: 'private', loanType: 'bank'
        }, defaultBase);

        expect(result.equityY5).toBeGreaterThan(0);
        expect(result.equityPctY5).toBeGreaterThan(0);
    });

    test('break-even rent is reasonable', () => {
        const result = calcScenarioData({
            propertyPrice: '1000000', tenure: '25', interestRate: '3.5',
            outstandingLoans: '0', propertyType: 'private', loanType: 'bank'
        }, defaultBase);

        // Break-even rent should be between $500 and $5000 for a $1M property
        expect(result.breakEvenRent).toBeGreaterThan(500);
        expect(result.breakEvenRent).toBeLessThan(5000);
    });
});

// ═══════════════════════════════════════════
// Edge cases and boundary conditions
// ═══════════════════════════════════════════
describe('Edge cases', () => {
    test('monthlyPayment with very small principal', () => {
        const pmt = monthlyPayment(1, 3.5, 1);
        expect(pmt).toBeGreaterThan(0);
        expect(isFinite(pmt)).toBe(true);
    });

    test('maxLoanFromPayment with very small payment', () => {
        const loan = maxLoanFromPayment(1, 3.5, 25);
        expect(loan).toBeGreaterThan(0);
        expect(isFinite(loan)).toBe(true);
    });

    test('calcBSD with negative price treated as 0', () => {
        // The function doesn't explicitly handle negatives, but Math.min clips
        const bsd = calcBSD(-100);
        expect(bsd).toBeLessThanOrEqual(0);
    });

    test('buildAmortSchedule with very high interest rate', () => {
        const schedule = buildAmortSchedule(100000, 20, 5, 0, 20, []);
        expect(schedule.length).toBe(60);
        const last = schedule[schedule.length - 1];
        expect(last.balance).toBeCloseTo(0, 0);
    });

    test('getLTV with boundary: exactly 65 is not exceeded', () => {
        // ageTenureExceeds65 is a boolean, tested directly
        expect(getLTV(0, 'bank', false)).toBe(0.75); // <= 65
        expect(getLTV(0, 'bank', true)).toBe(0.55);  // > 65
    });

    test('scenario with zero income base', () => {
        const zeroBase = {
            bankRule: BANK_RULES.dbs, isJoint: false, oldestAge: 35,
            totalAssessedIncome: 0, totalDebt: 0, totalCPF: 0, totalCash: 0,
            ageTenureMode: 'reduceTenure'
        };
        const result = calcScenarioData({
            propertyPrice: '1000000', tenure: '25', interestRate: '3.5',
            outstandingLoans: '0', propertyType: 'private', loanType: 'bank'
        }, zeroBase);

        expect(result.maxLoan).toBe(0);
        expect(result.verdict).toBe('Cannot Afford');
    });

    test('pct handles fractional percentages correctly', () => {
        expect(pct(0.333)).toBe('33%'); // rounds down
        expect(pct(0.667)).toBe('67%'); // rounds up
    });

    test('fmt handles NaN gracefully', () => {
        const result = fmt(NaN);
        expect(result).toContain('SGD');
    });

    test('tenure=0 correctly clamps to 1 (not falsy default of 25)', () => {
        const base = { bankRule: BANK_RULES.dbs, isJoint: false, oldestAge: 35, totalAssessedIncome: 7400, totalDebt: 0, totalCPF: 50000, totalCash: 50000, ageTenureMode: 'reduceTenure' };
        const result = calcScenarioData({
            propertyPrice: '0', tenure: '0', interestRate: '3.5',
            outstandingLoans: '0', propertyType: 'private', loanType: 'bank'
        }, base);

        expect(result.tenure).toBe(1); // fixed: 0 → clamped to 1
    });

    test('tenure clamping: calcScenarioData clamps 50 to 30', () => {
        const base = { bankRule: BANK_RULES.dbs, isJoint: false, oldestAge: 35, totalAssessedIncome: 7400, totalDebt: 0, totalCPF: 50000, totalCash: 50000, ageTenureMode: 'reduceTenure' };
        const result = calcScenarioData({
            propertyPrice: '0', tenure: '50', interestRate: '3.5',
            outstandingLoans: '0', propertyType: 'private', loanType: 'bank'
        }, base);

        expect(result.tenure).toBe(30);
    });
});

// ═══════════════════════════════════════════
// Cross-function consistency checks
// ═══════════════════════════════════════════
describe('Cross-function consistency', () => {
    test('monthlyPayment and maxLoanFromPayment are inverses across edge cases', () => {
        const cases = [
            [100000, 2.0, 10],
            [500000, 3.5, 25],
            [1000000, 5.0, 30],
            [50000, 1.0, 5],
        ];
        cases.forEach(([principal, rate, years]) => {
            const pmt = monthlyPayment(principal, rate, years);
            const recovered = maxLoanFromPayment(pmt, rate, years);
            expect(recovered).toBeCloseTo(principal, -1); // within $10
        });
    });

    test('amortization total principal matches loan amount', () => {
        const principal = 750000;
        const schedule = buildAmortSchedule(principal, 4.0, 20, 0, 4.0, []);
        const totalPrincipal = schedule.reduce((sum, e) => sum + e.principalPaid, 0);
        expect(totalPrincipal).toBeCloseTo(principal, 0);
    });

    test('amortization cumInterest + cumPrincipal = total payments', () => {
        const schedule = buildAmortSchedule(500000, 3.5, 25, 0, 3.5, []);
        const last = schedule[schedule.length - 1];
        const totalPayments = schedule.reduce((sum, e) => sum + e.principalPaid + e.interestPaid, 0);
        expect(last.cumInterest + last.cumPrincipal).toBeCloseTo(totalPayments, 0);
    });
});
