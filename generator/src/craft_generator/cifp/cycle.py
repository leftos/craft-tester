"""AIRAC cycle arithmetic and the FAA CIFP download URL.

Cycles run 28 days from the epoch 2025-01-23, the effective date of cycle 2501. A cycle id is
``YYNN`` where ``NN`` is the 1-based index of the cycle inside its calendar year, so 2026-01-22 is
``2601`` and 2026-09-03 is ``2609``.

Verified live on 2026-09-15:

* ``https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_260903.zip`` answers 200 with
  ``Content-Type: application/x-zip-compressed``, so the ``CIFP_<YYMMDD>.zip`` filename pattern in
  the plan is correct as written; the previous cycle ``CIFP_260806.zip`` answers 200 as well.
* ``https://aeronav.faa.gov/d-tpp/2609/`` answers 200, confirming 2026-09-03 is an effective date and
  that its cycle id is ``2609`` under this arithmetic.
* The zip holds ``FAACIFP18`` (53,173,344 bytes uncompressed) alongside four documentation members.
"""

from datetime import date, timedelta

AIRAC_EPOCH = date(2025, 1, 23)
CYCLE_DAYS = 28
CIFP_MEMBER = "FAACIFP18"
_CIFP_URL_TEMPLATE = "https://aeronav.faa.gov/Upload_313-d/cifp/CIFP_{stamp}.zip"


def effective_date_for(today: date) -> date:
    """Return the effective date of the AIRAC cycle that contains ``today``.

    Args:
        today: Any date on or after the AIRAC epoch.

    Returns:
        The latest effective date less than or equal to ``today``.

    Raises:
        ValueError: ``today`` falls before the 2025-01-23 epoch, where cycle ids are unknown.
    """
    if today < AIRAC_EPOCH:
        raise ValueError(f"{today.isoformat()} is before the AIRAC epoch {AIRAC_EPOCH.isoformat()}; cycle ids are only defined from the epoch on")
    elapsed = (today - AIRAC_EPOCH).days
    return AIRAC_EPOCH + timedelta(days=elapsed - elapsed % CYCLE_DAYS)


def is_effective_date(day: date) -> bool:
    """Return whether ``day`` is the first day of an AIRAC cycle."""
    return day >= AIRAC_EPOCH and (day - AIRAC_EPOCH).days % CYCLE_DAYS == 0


def first_effective_date_of_year(year: int) -> date:
    """Return the first AIRAC effective date that falls in ``year``."""
    january_first = date(year, 1, 1)
    if january_first <= AIRAC_EPOCH:
        return AIRAC_EPOCH
    offset = (january_first - AIRAC_EPOCH).days
    cycles = -(-offset // CYCLE_DAYS)
    return AIRAC_EPOCH + timedelta(days=cycles * CYCLE_DAYS)


def cycle_id_for(effective: date) -> str:
    """Return the ``YYNN`` cycle id of an effective date.

    Args:
        effective: The first day of an AIRAC cycle.

    Returns:
        The cycle id, e.g. ``"2609"`` for 2026-09-03.

    Raises:
        ValueError: ``effective`` is not the first day of a cycle.
    """
    if not is_effective_date(effective):
        raise ValueError(
            f"{effective.isoformat()} is not an AIRAC effective date; the containing cycle starts {effective_date_for(effective).isoformat()}"
        )
    index = (effective - first_effective_date_of_year(effective.year)).days // CYCLE_DAYS + 1
    return f"{effective.year % 100:02d}{index:02d}"


def effective_date_for_cycle(cycle_id: str) -> date:
    """Return the effective date of a ``YYNN`` cycle id.

    Args:
        cycle_id: Four-digit cycle id such as ``"2609"``.

    Returns:
        The first day of that cycle.

    Raises:
        ValueError: The id is malformed or names a cycle that does not exist in its year.
    """
    if len(cycle_id) != 4 or not cycle_id.isdigit():
        raise ValueError(f"cycle id must be four digits in YYNN form such as 2609, got {cycle_id!r}")
    year = 2000 + int(cycle_id[:2])
    index = int(cycle_id[2:])
    if index < 1:
        raise ValueError(f"cycle id {cycle_id!r} has a zero cycle number; cycle numbers are 1-based")
    effective = first_effective_date_of_year(year) + timedelta(days=(index - 1) * CYCLE_DAYS)
    if effective.year != year:
        raise ValueError(f"cycle id {cycle_id!r} resolves to {effective.isoformat()}, which is outside {year}")
    return effective


def cifp_url(effective: date) -> str:
    """Return the FAA CIFP zip URL for an AIRAC effective date.

    Args:
        effective: The first day of an AIRAC cycle.

    Returns:
        The absolute URL of ``CIFP_<YYMMDD>.zip``.

    Raises:
        ValueError: ``effective`` is not the first day of a cycle.
    """
    if not is_effective_date(effective):
        raise ValueError(f"{effective.isoformat()} is not an AIRAC effective date; no CIFP zip is published for it")
    return _CIFP_URL_TEMPLATE.format(stamp=effective.strftime("%y%m%d"))
