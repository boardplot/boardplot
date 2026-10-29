### Fixed

- The event lane of line, column and combo charts fits more events as text blocks. Before, an event whose pole grazed the end of an earlier block fell back to a numbered marker with a key entry, even when the lane had a free row. The lane now turns one placed block to the other side of its pole when that frees room for the next event. Golden changes: `column/weekly-events-lane` and `combo/weekly-events-lane` (both variants) draw the 26 Aug launch in the lane instead of key entry 4, and the 10 Aug block turns left of its pole.
