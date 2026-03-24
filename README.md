# Singapore Mortgage Calculator

A simple, browser-based calculator to estimate your maximum mortgage in Singapore based on MAS (Monetary Authority of Singapore) regulations.

## Features

- **TDSR** (Total Debt Servicing Ratio) — 55% of gross monthly income
- **MSR** (Mortgage Servicing Ratio) — 30% for HDB flats and Executive Condos
- **LTV** (Loan-to-Value) limits based on outstanding home loans
- **MAS stress test** interest rate applied automatically
- Estimates maximum loan amount, monthly repayment, and max property price

## Usage

Open `index.html` in any web browser. No server or installation required.

## Singapore Mortgage Rules Applied

| Rule | Limit | Applies To |
|------|-------|------------|
| TDSR | 55% of gross income | All properties |
| MSR  | 30% of gross income | HDB & EC from developer |
| LTV (1st loan, bank) | 75% | Private & HDB |
| LTV (2nd loan, bank) | 45% | All |
| LTV (HDB loan) | 80% | HDB only |
| Stress test rate | max(4%, actual + 0.5%) | Bank loans |
