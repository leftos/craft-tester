from craft_generator.cifp.waypoints import IDENT_COLUMNS, RNAV_WAYPOINT, TYPE_COLUMNS, parse_waypoints

CONTINUATION_COLUMN = 21
TERMINAL_ROW_IDENT = "AAAME"
CONTINUATION_ROW_IDENT = "AAERO"


def _row(waypoint_lines: list[str], ident: str) -> str:
    rows = [line for line in waypoint_lines if line[IDENT_COLUMNS[0] : IDENT_COLUMNS[1]].strip() == ident]
    assert len(rows) == 1
    return rows[0]


def _with_type(line: str, kind: str) -> str:
    return line[: TYPE_COLUMNS[0]] + kind.ljust(TYPE_COLUMNS[1] - TYPE_COLUMNS[0]) + line[TYPE_COLUMNS[1] :]


def _with_ident(line: str, ident: str) -> str:
    return line[: IDENT_COLUMNS[0]] + ident.ljust(IDENT_COLUMNS[1] - IDENT_COLUMNS[0]) + line[IDENT_COLUMNS[1] :]


def test_the_type_column_names_the_kind_of_waypoint(ksfo_waypoints: dict[str, str]) -> None:
    assert ksfo_waypoints["NTELL"] == RNAV_WAYPOINT
    assert ksfo_waypoints["ALTAM"] == "C"
    assert ksfo_waypoints["COLLI"] == "R"


def test_the_other_type_letters_are_read_as_the_file_states_them(waypoint_lines: list[str]) -> None:
    row = _row(waypoint_lines, "COLLI")
    assert [parse_waypoints([_with_type(row, kind)]) for kind in ("I", "N", "V")] == [{"COLLI": "I"}, {"COLLI": "N"}, {"COLLI": "V"}]


def test_a_terminal_waypoint_row_is_read_too(ksfo_waypoints: dict[str, str]) -> None:
    assert ksfo_waypoints[TERMINAL_ROW_IDENT] == RNAV_WAYPOINT


def test_a_continuation_record_is_skipped(waypoint_lines: list[str], ksfo_waypoints: dict[str, str]) -> None:
    assert _row(waypoint_lines, CONTINUATION_ROW_IDENT)[CONTINUATION_COLUMN] == "2"
    assert CONTINUATION_ROW_IDENT not in ksfo_waypoints


def test_an_enroute_row_wins_over_a_terminal_row_of_the_same_identifier(waypoint_lines: list[str]) -> None:
    enroute = _row(waypoint_lines, "NTELL")
    terminal = _with_type(_with_ident(_row(waypoint_lines, TERMINAL_ROW_IDENT), "NTELL"), "R")
    assert parse_waypoints([terminal, enroute])["NTELL"] == RNAV_WAYPOINT
    assert parse_waypoints([enroute, terminal])["NTELL"] == RNAV_WAYPOINT
