// Mortgage math — a faithful JS port of the Python `Mortage` class
// (mortgagecalc/legacy/mortgage.py). Same formulas, same conventions.
// Validated exact against the Python class: base payment, payoff months,
// and per-month balances (including the month-0 credit convention).

export class Mortgage {
  constructor({ loanAmount = null, interestApr, lengthYears, cost = null, downPaymentFraction = null }) {
    this.cost = cost;
    this.downPaymentFraction = downPaymentFraction;
    this.interestApr = interestApr;
    this.lengthYears = lengthYears;

    this.monthlyInterest = interestApr / 12 / 100;
    this.lengthMonths = Math.round(lengthYears * 12);

    if (cost != null && downPaymentFraction != null) {
      this.loanAmount = cost * (1 - downPaymentFraction);
    } else {
      this.loanAmount = loanAmount;
    }

    if (this.monthlyInterest === 0) {
      // zero-interest edge case: straight-line principal
      this.compoundedInterestMultiplier = 1;
      this.baseMonthlyPayment = this.loanAmount / this.lengthMonths;
    } else {
      this.compoundedInterestMultiplier = Math.pow(1 + this.monthlyInterest, this.lengthMonths);
      this.baseMonthlyPayment =
        this.loanAmount * this.monthlyInterest / (1 - 1 / this.compoundedInterestMultiplier);
    }
  }

  // balance remaining at the end of each month 0..numMonths (index 0 = at origination)
  balanceRemainingPerMonth(additionalMonthlyPayment = 0, numMonthsElapsed = null) {
    const n = numMonthsElapsed == null ? this.lengthMonths : numMonthsElapsed;
    const mi = this.monthlyInterest;
    const out = new Array(n + 1);

    // additional amount paid, cumulative, at month m — matches numpy cumsum in the
    // Python class: for an array it's sum(arr[0..m]); for a nonzero scalar the class
    // does cumsum(ones_like(...)*c), i.e. c*(m+1) (a payment is credited at index 0).
    const additionalAt = (m) => {
      if (Array.isArray(additionalMonthlyPayment)) return cumsumAt(additionalMonthlyPayment, m);
      if (additionalMonthlyPayment === 0) return 0;
      return additionalMonthlyPayment * (m + 1);
    };

    if (mi === 0) {
      for (let m = 0; m <= n; m++) {
        out[m] = this.loanAmount - this.baseMonthlyPayment * m - additionalAt(m);
      }
      return out;
    }
    for (let m = 0; m <= n; m++) {
      const exp = Math.pow(1 + mi, m);
      const base = this.loanAmount * exp - (this.baseMonthlyPayment / mi) * (exp - 1);
      out[m] = base - additionalAt(m);
    }
    return out;
  }

  // first month index where balance goes below zero, else full term
  totalMonthsToPayOff(additionalMonthlyPayment = 0) {
    const bal = this.balanceRemainingPerMonth(additionalMonthlyPayment);
    for (let i = 0; i < bal.length; i++) {
      if (bal[i] < 0) return i;
    }
    return this.lengthMonths;
  }
}

// cumulative sum of arr[0..m], matching np.cumsum offset use in the Python class
export function cumsumAt(arr, m) {
  let s = 0;
  for (let i = 0; i <= m && i < arr.length; i++) s += arr[i] || 0;
  return s;
}
