// Simple spaced-repetition scheduler.
// Ladder mirrors the app spec: Again -> 10 min, Hard -> 1 day (fixed, does
// not advance the ladder), Good -> next ladder step, Easy -> skip a step.
// Ladder days: 3, 7, 14, 30, 60, 90 (then holds at 90 / "mastered").
const SRS = (() => {
  const LADDER_DAYS = [3, 7, 14, 30, 60, 90];
  const AGAIN_MINUTES = 10;
  const HARD_DAYS = 1;

  function addMinutes(date, mins) { return new Date(date.getTime() + mins * 60000); }
  function addDays(date, days) { return new Date(date.getTime() + days * 86400000); }

  function statusForIndex(index) {
    if (index < 0) return 'learning';
    if (index >= LADDER_DAYS.length - 1) return 'mastered';
    if (index >= 2) return 'review';
    return 'learning';
  }

  // word: the merged word+progress object. grade: 'again' | 'hard' | 'good' | 'easy'
  // Returns a patch object to pass into DB.updateProgress(word.id, patch).
  function grade(word, gradeName) {
    const now = new Date();
    let index = typeof word.interval === 'number' ? word.interval : -1;
    let dueDate;
    let correct = true;

    if (gradeName === 'again') {
      index = -1;
      dueDate = addMinutes(now, AGAIN_MINUTES);
      correct = false;
    } else if (gradeName === 'hard') {
      dueDate = addDays(now, HARD_DAYS);
      correct = true;
    } else if (gradeName === 'good') {
      index = Math.min(index + 1, LADDER_DAYS.length - 1);
      dueDate = addDays(now, LADDER_DAYS[index]);
      correct = true;
    } else if (gradeName === 'easy') {
      index = Math.min(index + 2, LADDER_DAYS.length - 1);
      dueDate = addDays(now, LADDER_DAYS[index]);
      correct = true;
    }

    return {
      interval: index,
      dueDate: dueDate.toISOString().slice(0, 10),
      dueAt: dueDate.toISOString(),
      reviewStatus: statusForIndex(index),
      reviewCount: (word.reviewCount || 0) + 1,
      correctCount: (word.correctCount || 0) + (correct ? 1 : 0),
      incorrectCount: (word.incorrectCount || 0) + (correct ? 0 : 1),
      lastReviewed: now.toISOString(),
    };
  }

  function isDue(word) {
    if (!word.dueAt) return (word.dueDate || '') <= new Date().toISOString().slice(0, 10);
    return new Date(word.dueAt).getTime() <= Date.now();
  }

  // A word is "difficult" / frequently forgotten if it has enough attempts
  // and a poor accuracy ratio.
  function isDifficult(word) {
    const total = (word.correctCount || 0) + (word.incorrectCount || 0);
    if (total < 2) return false;
    const wrongRatio = (word.incorrectCount || 0) / total;
    return wrongRatio >= 0.34 || (word.incorrectCount || 0) >= 3;
  }

  return { grade, isDue, isDifficult, LADDER_DAYS };
})();
