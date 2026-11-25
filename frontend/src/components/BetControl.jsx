export default function BetControl({ amount, onChange, balance, disabled }) {
  return (
    <div className="bet-control">
      <label>
        Wager (chips)
        <input
          type="number"
          min="1"
          max={Math.min(balance ?? 1000000, 1000000)}
          step="1"
          value={amount}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <div aria-label="Choose chip denomination" className="bet-denominations">
        {[1, 5, 10, 25, 100].map((value) => (
          <button
            type="button"
            className="secondary"
            key={value}
            disabled={disabled || (balance != null && value > balance)}
            onClick={() => onChange(String(value))}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}
