# Finance notebooks

Ad-hoc analysis against the production billing API.

Before running, export the platform key:

    export STRIPE_API_KEY="$(op read op://finance/stripe/live_secret)"

Please clear outputs before committing (`nbstripout --install` sets this up
as a pre-commit hook). The hook is not enforced in CI yet.
