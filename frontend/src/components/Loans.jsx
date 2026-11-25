import { useState } from "react";

export default function Loans({ loans, userId, busy, onAction }) {
  const [amounts, setAmounts] = useState({});
  const relevant = loans.filter((loan) =>
    ["pending", "accepted", "overdue"].includes(loan.status),
  );
  if (!relevant.length) return null;
  return (
    <section className="loan-list">
      <h3>Loans</h3>
      <p>72 hours · no interest · limit 500 chips</p>
      {relevant.map((loan) => {
        const borrower = loan.borrower.id === userId;
        const initiated = loan.initiatedBy === userId;
        return (
          <div className="loan-row" key={loan.id}>
            <strong>
              {borrower
                ? `Borrow from ${loan.lender.username}`
                : `Lend to ${loan.borrower.username}`}
            </strong>
            <span>
              {loan.status} · {loan.outstanding} / {loan.principal} chips{" "}
              {loan.deadline &&
                `· due ${new Date(loan.deadline).toLocaleString()}`}
            </span>
            {loan.status === "overdue" && borrower && (
              <span className="loan-overdue">
                Overdue: repay before sending or borrowing more chips.
              </span>
            )}
            {loan.status === "pending" &&
              (initiated ? (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => onAction(loan.id, "cancel")}
                >
                  Cancel
                </button>
              ) : (
                <>
                  <button
                    disabled={busy}
                    onClick={() => onAction(loan.id, "accept")}
                  >
                    Accept terms
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => onAction(loan.id, "decline")}
                  >
                    Decline
                  </button>
                </>
              ))}
            {borrower && ["accepted", "overdue"].includes(loan.status) && (
              <div className="loan-repay">
                <input
                  type="number"
                  min="1"
                  max={loan.outstanding}
                  aria-label={`Repayment for ${loan.lender.username}`}
                  value={amounts[loan.id] ?? loan.outstanding}
                  onChange={(event) =>
                    setAmounts({ ...amounts, [loan.id]: event.target.value })
                  }
                />
                <button
                  disabled={busy}
                  onClick={() =>
                    onAction(
                      loan.id,
                      "repay",
                      Number(amounts[loan.id] ?? loan.outstanding),
                    )
                  }
                >
                  Repay
                </button>
              </div>
            )}
            {loan.repayments.length > 0 && (
              <details>
                <summary>Repayment history</summary>
                {loan.repayments.map((repayment, index) => (
                  <div key={index}>
                    {repayment.amount} chips ·{" "}
                    {new Date(repayment.at).toLocaleString()}
                  </div>
                ))}
              </details>
            )}
          </div>
        );
      })}
    </section>
  );
}
