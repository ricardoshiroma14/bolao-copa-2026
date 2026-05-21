# Scoring Rules

The defaults are stored on each `pools` row and can be adjusted in the database.

## Match Predictions

- Exact score: `scoring_exact`
- Correct winner/draw with one exact team score: `scoring_diff`
- Correct winner/draw only: `scoring_winner`
- Incorrect result: zero

## Knockout Predictions

The app tracks team hits across:

- Qualified from groups / round of 32 setup
- Round of 16
- Quarterfinals
- Semifinals
- Third-place match
- Final
- Champion

The ranking table displays counts and points by phase. The scoring function recalculates stored prediction points after results are updated.

## Payment Eligibility

The ranking can distinguish paid/confirmed members. By default, payment copy is template-safe and controlled by `VITE_PAYMENT_*` variables.
