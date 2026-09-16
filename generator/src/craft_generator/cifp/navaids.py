"""Navaid names from the ARINC 424 VHF navaid and NDB rows of the CIFP.

Layout verified against ``FAACIFP18`` from cycle 2609 (effective 2026-09-03), 2,466 navaid rows,
every row exactly 132 characters. The Red Bluff row reads::

    SUSAD        RBL   K2011570VTHW N40055608W122141086    ...    NARRED BLUFF ...

Record type ``S`` sits at ``[0]``, the customer area at ``[1:4]``, section ``D`` at ``[4]`` and the
subsection at ``[5]``: blank for a VHF navaid, ``B`` for an NDB. Both kinds carry the identifier at
``[13:17]``, the region code at ``[19:21]``, the navaid class at ``[27:32]`` and the name at
``[93:123]``, which the North American datum code ``NAR`` at ``[90:93]`` immediately precedes.

The file is read whole, with no customer-area filter, because the FAA files Alaska under the ``CAN``
area - Annette Island is ``CAN``/``PA``, and KSFO routes to Seoul fly over it - so an area filter
would drop navaids a US clearance names. Two navaids may share an identifier; 54 two- and
three-letter identifiers do in 2609. A record whose region code is ``K1``..``K7`` wins, as the
trainer reads clearances at US airports. When the survivors still disagree, a name they all share
resolves to the VHF record rather than the NDB, and names that differ drop the identifier rather
than guess at it, so a clearance that references it fails the build instead of naming the wrong
place.

The navaid class field is five characters: ``[27]`` is ``V`` for a VOR, ``[28]`` names the ranging
facility (``D`` DME, ``T`` TACAN, ``M`` military TACAN, ``I`` ILS/DME, ``N`` and ``P`` MLS/DME), and
the remaining three are the range, the voice feature and the collocation, which the trainer does not
use. ``VTHW`` is a VORTAC (Red Bluff), ``VDHW`` a VOR/DME (Oakland) and ``" DLW "`` a stand-alone
DME (Pawnee City).
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Literal

NavaidKind = Literal["VOR", "VOR/DME", "VORTAC", "DME", "TACAN", "NDB"]

RECORD_LENGTH = 132
SECTION_CODE = "D"
IDENT_COLUMNS = (13, 17)
REGION_COLUMNS = (19, 21)
CLASS_COLUMNS = (27, 32)
NAME_COLUMNS = (93, 123)

NDB_KIND: NavaidKind = "NDB"

_CONTINUATION_COLUMN = 21
_PRIMARY_CONTINUATION_NUMBERS = frozenset({"0", "1"})
_VHF_SUBSECTION = " "
_NDB_SUBSECTION = "B"
_VOR_FLAG = "V"
_DME_FACILITIES = frozenset({"D", "I", "N", "P"})
_TACAN_FACILITIES = frozenset({"T", "M"})
_US_REGIONS = frozenset(f"K{digit}" for digit in "1234567")
_TYPE_WORDS: dict[str, str] = {"VOR": "VOR", "VOR/DME": "VOR", "VORTAC": "VOR", "DME": "DME", "TACAN": "TACAN", "NDB": "NDB"}


@dataclass(frozen=True, slots=True)
class Navaid:
    """One navaid as the CIFP publishes it."""

    ident: str
    name: str
    kind: NavaidKind

    @property
    def type_word(self) -> str:
        """Return the facility word said after the name; every VOR-based facility is just ``VOR``."""
        return _TYPE_WORDS[self.kind]

    @property
    def spoken(self) -> str:
        """Return the navaid as it is read on frequency, e.g. ``Red Bluff VOR`` for the RBL VORTAC."""
        return f"{self.name} {self.type_word}"


def _title_case(field: str) -> str:
    return " ".join(word.capitalize() for word in field.split())


def _vhf_kind(navaid_class: str) -> NavaidKind | None:
    vor = navaid_class[:1] == _VOR_FLAG
    facility = navaid_class[1:2]
    if facility in _TACAN_FACILITIES:
        return "VORTAC" if vor else "TACAN"
    if facility in _DME_FACILITIES:
        return "VOR/DME" if vor else "DME"
    return "VOR" if vor else None


def parse_navaid_record(line: str) -> tuple[Navaid, str] | None:
    """Parse one CIFP line into a navaid and the region code it is published under.

    Args:
        line: A single CIFP line, without its newline.

    Returns:
        The navaid and its two-character region code, or ``None`` when the line is not a navaid row
        or publishes no name or no facility the trainer can name. Continuation records are skipped,
        because the columns this reads as the class and the name carry other fields there. Any input
        is accepted; nothing about a malformed line raises.
    """
    if len(line) < RECORD_LENGTH or line[0] != "S" or line[4] != SECTION_CODE:
        return None
    if line[_CONTINUATION_COLUMN] not in _PRIMARY_CONTINUATION_NUMBERS:
        return None
    subsection = line[5]
    if subsection == _NDB_SUBSECTION:
        kind: NavaidKind | None = NDB_KIND
    elif subsection == _VHF_SUBSECTION:
        kind = _vhf_kind(line[CLASS_COLUMNS[0] : CLASS_COLUMNS[1]])
    else:
        return None
    ident = line[IDENT_COLUMNS[0] : IDENT_COLUMNS[1]].strip()
    name = _title_case(line[NAME_COLUMNS[0] : NAME_COLUMNS[1]])
    if kind is None or not ident or not name:
        return None
    return Navaid(ident=ident, name=name, kind=kind), line[REGION_COLUMNS[0] : REGION_COLUMNS[1]]


def _resolve(records: Sequence[tuple[Navaid, str]]) -> Navaid | None:
    preferred = [navaid for navaid, region in records if region in _US_REGIONS] or [navaid for navaid, _ in records]
    if len({(navaid.name, navaid.kind) for navaid in preferred}) == 1:
        return preferred[0]
    if len({navaid.name for navaid in preferred}) > 1:
        return None
    vhf = [navaid for navaid in preferred if navaid.kind != NDB_KIND]
    return vhf[0] if len({(navaid.name, navaid.kind) for navaid in vhf}) == 1 else None


def parse_navaids(lines: Iterable[str]) -> dict[str, Navaid]:
    """Read every navaid the CIFP names, keyed by identifier.

    Args:
        lines: CIFP lines in file order; trailing newlines are tolerated.

    Returns:
        One navaid per identifier. An identifier two navaids publish under different names is left
        out, so nothing downstream can speak a name the file does not settle.
    """
    found: dict[str, list[tuple[Navaid, str]]] = {}
    for raw in lines:
        record = parse_navaid_record(raw.rstrip("\r\n"))
        if record is not None:
            found.setdefault(record[0].ident, []).append(record)
    resolved = ((ident, _resolve(records)) for ident, records in found.items())
    return {ident: navaid for ident, navaid in resolved if navaid is not None}
