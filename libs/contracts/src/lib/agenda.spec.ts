import { agendaArea } from './agenda.js';

describe('agendaArea', () => {
  it('names an area from its sources, and your own items', () => {
    expect(agendaArea('cars')).toEqual({ name: 'Cars', emblem: '🚗' });
    expect(agendaArea('agenda')).toEqual({ name: 'My items', emblem: '🗓️' });
  });

  it('falls back to the module id', () => {
    expect(agendaArea('mars')).toEqual({ name: 'mars', emblem: '•' });
  });
});
