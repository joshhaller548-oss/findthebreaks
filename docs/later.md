# Later, not version one

Drill ideas that came up while building version one. None of these is in v1.

## Once on demurrage, always on demurrage

When laytime runs out, exceptions stop applying: a Sunday or a rain stoppage
after that point still counts as time on demurrage, unless the charterparty
says otherwise. The v1 drills compute used minus allowed, which gives the same
answer only when no exception falls after laytime expires. The v1 data is
built so that none does, and both checks assert it. A later drill should
plant an exception after expiry and teach the difference.

## Dirty data task

Decimal BL tonnages (BL figures are usually to three decimals), counterparty
name variants and trailing whitespace. Each makes a good drill, but in v1
they would make the checker brittle and the user frustrated.

## The seven operator tasks from the brief

Position reporting, freight economics and netbacks, quality and quantity
claims, pricing periods and index averaging, matching physical against the
hedge, credit exposure against counterparty limits, month-end close.
