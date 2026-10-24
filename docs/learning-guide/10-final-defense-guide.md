# 10 — Final defense guide

Use the implementation and executed evidence rather than memorizing claims.
Replace any proposal wording that still describes completed work as future plans.
The current proposal DOCX was preserved; it was not silently rewritten.

## Suggested live demonstration

1. Start FastAPI, Express, and React before presenting. Check their health endpoints.
2. Register a disposable account and explain the HTTP-only login cookie.
3. Play single-player with two bots. Request advice before acting; show that the
   assistant does not move cards until the person clicks a gameplay button.
4. Stand or hit, then identify bots acting through the model and the dealer using
   fixed S17 rules. Explain a natural Blackjack or scoring example from unit tests.
5. Open the profile and show actual history and statistics saved in Atlas.
6. Use another browser profile for a second account. Create/join a private room,
   start, and demonstrate synchronized turns and rejected out-of-turn actions.
7. Disconnect one participant, explain the automatic stand, and show host transfer.
8. Show tests and measured model results. If a service is unavailable, show its
   real error; do not substitute a prerecorded result and call it live.

Keep a short screen recording as a clearly labeled backup for network outages,
and keep test output/evaluation JSON available locally. Never project `.env`.

## Likely technical questions and sample answers

1. **What problem does this project solve?**
   It brings casual private Blackjack, computer tablemates, and strategy study
   into one student-built application. We do not claim these individual ideas
   are new or that our model always plays optimally.

2. **Explain the architecture in one minute.**
   React displays permitted state. Express authenticates people, owns games,
   and uses Socket.IO for room updates. MongoDB stores accounts and finished
   outcomes. FastAPI loads our PyTorch checkpoint for four-feature inference.
   TensorFlow is used offline for training.

3. **Why does the backend own cards?**
   Browser JavaScript can be modified by the player. Keeping the shoe, hidden
   card, turns, and result calculation on the server prevents client-selected
   cards or forged outcomes from becoming official state.

4. **How is the shoe shuffled?**
   We create six standard decks and run Fisher–Yates using cryptographic
   `randomInt`. Each round starts with a fresh 312-card shoe. This is different
   from carrying a casino shoe through many rounds.

5. **How do you score multiple Aces?**
   Count all Aces as 1, then add 10 for one Ace if the result remains at most
   21. An Ace is usable only while it counts as 11.

6. **Does every 21 count as Blackjack?**
   No. Natural Blackjack is exactly two initial cards: an Ace and ten-value
   card. It beats a normal 21, and two naturals push.

7. **Why does the dealer stand on A+6?**
   Our rules explicitly use stand-on-soft-17. The dealer hits below 17 and
   never calls the neural network.

8. **What type of machine learning is this?**
   Supervised classification. A reference HIT/STAND strategy labels legal
   states, and TensorFlow trains a network to imitate those labels.

9. **Is this reinforcement learning?**
   No. There is no reward update during gameplay. Wins and losses update user
   statistics, not model weights.

10. **What are the four inputs?**
    Best player total, dealer visible value with Ace=11, usable-Ace flag, and
    player card count. The hidden card and remaining shoe are excluded.

11. **Why normalize features?**
    Features have different numerical ranges. Fixed scaling keeps their input
    sizes comparable. The exact same preprocessing must be used in training
    and deployment; the scales are `[21,11,1,20]` in `model.py`.

12. **Explain the 234 parameters.**
    First dense layer: `4×16+16=80`. Second: `16×8+8=136`. Output:
    `8×2+2=18`. The total is 234 weights and biases.

13. **What does ReLU do?**
    It replaces negative layer outputs with zero and leaves positive values.
    These nonlinear transformations let the network learn decision boundaries
    more complex than one linear rule.

14. **What does Softmax mean here?**
    It turns two logits into nonnegative action-class scores summing to one.
    The larger score chooses STAND (index 0) or HIT (index 1). The scores are
    not probabilities of winning a hand.

15. **What is the loss?**
    Sparse categorical cross-entropy, negative log score of the correct
    labeled action. It measures classification error against reference labels,
    not money or Blackjack losses.

16. **What is backpropagation?**
    It uses the chain rule to calculate how each weight affects the loss.
    Adam uses those gradients to update weights during offline training.

17. **Why TensorFlow and PyTorch together?**
    We preserve our existing TensorFlow training approach and use the saved
    PyTorch format for inference. Conversion transposes Dense kernels and
    copies biases; full-domain output/action comparisons verify equivalence.

18. **How did you fix the six-card limit?**
    The final data generator in `model.py` enumerates reachable states through
    twenty cards and normalizes card count by twenty. The shipped model was
    trained on that domain in TensorFlow and converted to PyTorch. During code
    cleanup we retained its weights and verified all 2,190 actions and scores.

19. **Why is the maximum twenty cards?**
    A non-busting 21-card hand would need all Aces. The game automatically
    stops at soft 21 after eleven Aces, so that sequence cannot reach 21 cards.
    A 20-card terminal hand is reachable with nineteen Aces and a 2 in a valid
    order. Nineteen cards is the maximum that can still need a decision.

20. **How did you avoid train/test leakage?**
    We deduplicate feature tuples before a class-stratified split. Train,
    validation, and test indices are disjoint. These remain closely related
    states in a finite strategy domain, so accuracy is not broad real-world
    generalization evidence.

21. **What accuracy did you actually measure?**
    The recorded model got 327/329 held-out labels correct: 99.39%,
    loss 0.02203. Whole-domain reference agreement is 2186/2190. The evaluation
    JSON includes counts, confusion matrix, per-card results, and disagreements.

22. **Does 99.39% mean a 99.39% chance to win?**
    No. It is agreement with reference labels, not a win-rate measurement.
    Card draws are uncertain, and choosing the reference action can still lose
    a round. We do not present Softmax scores or accuracy as winning probabilities.

23. **Can your assistant explain what neurons are thinking?**
    No. It compares the actual network output with reference rules and states
    agreement or disagreement. We do not claim rule-based explanation text
    exposes the internal reasoning of the network.

24. **How do bots differ from the assistant?**
    Both use the same checkpoint and feature builder. Bots automatically pass
    their predictions to the engine on their own turns. Advice returns data
    only; a human must explicitly select the move.

25. **What happens if FastAPI stops?**
    A bot pauses with an explicit retry option. Advice reports an error, and
    a human may still choose a legal move. No rule-based or random decision
    is secretly presented as a network prediction.

26. **How do multiplayer clients stay synchronized?**
    There is one authoritative room/game object. The server validates events,
    changes that object, and broadcasts a permitted snapshot with its revision.
    Clients replace their display state; they do not run competing game engines.

27. **How do you stop duplicate or out-of-turn actions?**
    We authenticate the user, check room membership/current player, require
    current round ID and revision, and reject overlapping room mutations during
    awaited work. A duplicate old action cannot consume another card.

28. **What happens on disconnect?**
    Losing the last socket stands the user's unfinished hand, even before
    their turn. Rejoining restores connection status but not that turn. Host
    ownership moves to a connected person; disconnected seats leave next round.

29. **Can users inspect the dealer's hidden card in network responses?**
    The allowlisted serializer sends only the upcard and a hidden placeholder,
    with dealer total null. It never serializes the shoe. The complete dealer
    hand appears only after resolution.

30. **Why MongoDB and Mongoose?**
    Our data is naturally account, history, and statistics documents. Mongoose
    schemas define expected types and indexes, with ObjectId references linking
    history/statistics to users. This is a straightforward fit for our scope.

31. **What protects passwords and sessions?**
    Passwords use bcrypt hashes, not reversible encryption. JWT cookies are
    HTTP-only, SameSite=Strict, short-lived, and checked against a database session
    version. Logout revokes old tokens; production must use HTTPS/secure cookies.

32. **How do you protect another user's history?**
    Routes use the verified session's user ID in database filters. A submitted
    query parameter cannot choose a different owner. Protected endpoints require
    authentication before retrieving records.

33. **How do you prevent saving a round twice?**
    A unique `{user,roundId}` index is durable protection. Inside one transaction,
    already-existing history is skipped, and new history plus statistics commit
    together. A failed transaction rolls back rather than half-updating counters.

34. **What if Atlas fails during a round?**
    The completed result is shown as unsaved and can be retried. A new round is
    blocked until saving succeeds. An unsaved in-memory result can still be lost
    on Node restart, so we explicitly document that limit.

35. **What tests ran, and which parts used real services?**
    Thirty JavaScript tests cover the engine, isolated account logic, service
    failures, and actual local Socket.IO clients. Forty Python tests cover real
    model files, API behavior, and temporary training/export. Two opt-in integration
    tests use real FastAPI and Atlas
    where applicable. Two Chrome flows use the running application and real
    database. The verification report distinguishes these layers.

36. **What remains outside the delivered scope?**
    Public deployment, multi-server state coordination, durable active rounds,
    turn timers, password reset, and email verification. Required gameplay and
    account flows were verified locally; those additional features are not claimed.

## How to present ownership and limitations honestly

Each member should reproduce a small change, debug a failed test, and explain a
request outside their primary area. Be clear about tools used to assist development
and your own understanding. Do not say generated code proves engineering knowledge;
show that knowledge by tracing, modifying, and testing the implementation.

Read `docs/verification-report.md` immediately before the defense. If you change
weights, rules, schema, or request contracts, rerun the relevant checks and update
the figures. Never claim a simulator metric is a measured human-user study or a
production load-test result.
