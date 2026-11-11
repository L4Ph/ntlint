/**
 * The rules that ship.
 *
 * Two of jev-lint's test rules are deliberately not here, because neither fits
 * a subject that is one test: `tests-cover-failure-paths` pairs a function with
 * the tests that reach it, and `describe-names-subject` judges a suite against
 * the tests inside it. Both need a subject shape v0.1 does not have, and
 * shipping them as if they were test rules would judge the wrong thing.
 */
import testNameDescribesCode from "./test-name-describes-code.ts";
import snapshotOnlyBehaviourClaim from "./snapshot-only-behaviour-claim.ts";
import testAssertsSomething from "./test-asserts-something.ts";
import testAssertsTheOutcome from "./test-asserts-the-outcome.ts";
import testIsNotAbandoned from "./test-is-not-abandoned.ts";
import testMocksSubject from "./test-mocks-subject.ts";
import testNameIsASpecification from "./test-name-is-a-specification.ts";
import testNameVerifiesClaim from "./test-name-verifies-claim.ts";
import testStructureIsFlat from "./test-structure-is-flat.ts";
import testWaitsForTheEvent from "./test-waits-for-the-event.ts";
import type { Rule } from "../core/types.ts";

export const BUILTIN_RULES: readonly Rule[] = [
  testNameDescribesCode,
  testNameVerifiesClaim,
  testMocksSubject,
  snapshotOnlyBehaviourClaim,
  testAssertsSomething,
  testIsNotAbandoned,
  testWaitsForTheEvent,
  testStructureIsFlat,
  testAssertsTheOutcome,
  testNameIsASpecification,
];
