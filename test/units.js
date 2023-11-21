import { assert } from 'chai'
import sinon from 'sinon'
import { inspect } from 'util'
import fsm from '../index.js'

sinon.assert.expose(assert, { prefix: '' })

describe('a finite state machine', function () {
  let states, machine

  beforeEach(function () {
    states = {
      '*': {
        _exit: sinon.fake(),
        surge: 'blown-default',
        poke: sinon.fake(),
      },

      off: {
        _enter: sinon.fake(),
        _exit: sinon.fake(),
        toggle: 'on',
        surge: 'blown',
        kick: sinon.stub(),
        subscribe: sinon.fake(),
        symbolAction: Symbol.for('the nether'),
        dateAction: new Date(),
        objectAction: {},
        numericAction: 1,
        async asyncAction() {},
        arrowFunction: () => {
          this.shouldExplode()
        },
      },

      on: {
        _enter: sinon.fake(),
        toggle: 'off',
      },
    }

    machine = fsm('off', states)
  })

  afterEach(function () {
    sinon.restore()
  })

  describe('subscribe function', function () {
    it('should accept single argument callback function', function () {
      assert.doesNotThrow(() => {
        machine.subscribe(sinon.fake())
      })
    })

    it('should invoke callback on initial subscribe', function () {
      const callback = sinon.fake()
      const unsubscribe = machine.subscribe(callback)
      assert.calledOnce(callback)
      assert.calledWithExactly(callback, 'off')
      unsubscribe()
    })

    it('should throw TypeError when invoked with no args', function () {
      assert.throws(machine.subscribe, TypeError)
    })

    it('should throw TypeError when invoked with non-function arg', function () {
      assert.throws(() => {
        machine.subscribe('not a function')
      }, TypeError)
    })

    it('should not call subscribe action handler when invoked with multiple args', function () {
      machine.subscribe(sinon.fake(), null)
      assert.notCalled(states.off.subscribe)
    })
  })

  describe('event invocations', function () {
    let callback
    let unsubscribe

    beforeEach(function () {
      callback = sinon.fake()
      unsubscribe = machine.subscribe(callback)
      callback.resetHistory()
    })

    afterEach(function () {
      unsubscribe()
    })

    it('should silently handle unregistered actions', function () {
      assert.equal('off', machine.noop())
      assert.notCalled(callback)
    })

    it('should invoke registered action functions', function () {
      machine.kick()
      assert.calledOnce(states.off.kick)
    })

    it('should transition to static value registered action', function () {
      assert.equal('on', machine.toggle())
      assert.calledWithExactly(callback, 'on')
    })

    it('should not transition if invoked action returns nothing', function () {
      assert.equal('off', machine.kick())
      assert.notCalled(callback)
    })

    it('should transition to invoked action return value (string)', function () {
      states.off.kick.returns('on')
      assert.equal('on', machine.kick())
      assert.calledWithExactly(callback, 'on')
    })

    it('should transition to invoked action symbol value', function () {
      const newState = machine.symbolAction()
      assert.equal(Symbol.for('the nether'), newState)
      assert.calledWithExactly(callback, Symbol.for('the nether'))
    })

    it('should ignore non-string|symbol action return values', function () {
      assert.equal('off', machine.dateAction())
      assert.equal('off', machine.objectAction())
      assert.equal('off', machine.numericAction())
      assert.equal('off', machine.asyncAction())
    })

    it('should invoke action with correct `this` binding and arguments', function () {
      machine.kick('hard')
      assert.calledOn(states.off.kick, machine)
      assert.calledWithExactly(states.off.kick, 'hard')
    })

    it('should not bind `this` on actions defined as arrow functions', function () {
      assert.throws(machine.arrowFunction, TypeError)
    })

    // API change here. The notification callback will be called after
    // _enter, not before
    it('should call lifecycle actions in proper sequence', function () {
      machine.toggle()
      assert.isTrue(states.off._enter.calledBefore(states.off._exit))
      assert.isTrue(states.off._exit.calledBefore(callback))
      assert.isTrue(states.on._enter.calledBefore(callback))
    })

    it('should call _enter with appropirate metadata when fsm is created', function () {
      assert.calledWithExactly(states.off._enter, {
        from: null,
        to: 'off',
        event: null,
        args: [],
      })
    })

    it('should call lifecycle actions with transition metadata', function () {
      const expected = {
        from: 'off',
        to: 'on',
        event: 'toggle',
        args: [1, 'foo'],
      }
      machine.toggle(1, 'foo')
      assert.calledWithExactly(states.off._exit, expected)
      assert.calledWithExactly(states.on._enter, expected)
    })

    it('should not throw error when no matching state node', function () {
      machine.surge()
      assert.calledWithExactly(callback, 'blown')
      assert.doesNotThrow(() => machine.toggle())
    })

    it('should invoke fallback actions if no match on current state', function () {
      machine.poke()
      assert.called(states['*'].poke)
      machine.toggle()
      assert.equal('blown-default', machine.surge())
      assert.called(states['*']._exit)
    })

    it('should stop notifying after unsubscribe', function () {
      unsubscribe()
      machine.toggle()
      assert.notCalled(callback)
    })
  })

  describe('event debounce methods', function () {
    let clock

    beforeEach(function () {
      clock = sinon.useFakeTimers()
    })

    afterEach(function () {
      clock.restore()
    })

    it('should be a function', function () {
      assert.isFunction(machine.someEvent.debounce)
    })

    it('should invoke event after specified wait time', async function () {
      const debouncedKick = machine.kick.debounce(100)
      clock.tick(100)
      await debouncedKick
      assert.calledOnce(states.off.kick)
    })

    it('should pass arguments through to action', async function () {
      const debouncedKick = machine.kick.debounce(100, 'hard')
      clock.tick(100)
      await debouncedKick
      assert.calledWithExactly(states.off.kick, 'hard')
    })

    it('should debounce multiple calls within wait time', async function () {
      machine.kick.debounce(100, 1)
      clock.tick(50)
      const secondKick = machine.kick.debounce(100, 2)
      clock.tick(50)
      assert.notCalled(states.off.kick)
      clock.tick(50)
      await secondKick
      assert.calledWithExactly(states.off.kick, 2)
    })

    it('should invoke action after last call’s wait time', async function () {
      machine.kick.debounce(100, 1)
      clock.tick(50)
      const secondKick = machine.kick.debounce(10, 2)
      clock.tick(10)
      await secondKick
      assert.calledOnce(states.off.kick)
      assert.calledWithExactly(states.off.kick, 2)
    })

    it('should cancel debounce invocation if called with null', async function () {
      const kick = machine.kick.debounce(100, 1)
      const cancelation = machine.kick.debounce(null)
      clock.tick(100)
      const state = await cancelation
      assert.notCalled(states.off.kick)
      assert.include(inspect(kick), '<pending>')
      assert.equal('off', state)
    })
  })

  describe('automatic transitions', function () {
    let callback
    let unsubscribe

    beforeEach(function () {
      callback = sinon.fake()
      unsubscribe = machine.subscribe(callback)
      callback.resetHistory()
    })

    afterEach(function () {
      unsubscribe()
    })

    it('should perform an automatic transition once', function () {
      const enterOn = sinon.fake.returns('off')
      sinon.replace(states.on, '_enter', enterOn)
      machine.toggle()

      const expected = {
        from: 'off',
        to: 'on',
        event: 'toggle',
        args: [],
      }

      assert.equal(states.on._enter.callCount, 1)
      assert.calledWithExactly(states.on._enter, expected)
      assert.equal(states.off._enter.callCount, 2)

      assert.notCalled(callback)
    })

    it('should perform an automatic transition multiple times', function () {
      const enterOn = sinon.fake.returns('off')
      sinon.replace(states.on, '_enter', enterOn)

      machine.toggle()
      machine.toggle()
      machine.toggle()
      machine.toggle()

      assert.equal(states.on._enter.callCount, 4)

      const expected = {
        from: 'off',
        to: 'on',
        event: 'toggle',
        args: [],
      }

      assert.equal(states.on._enter.callCount, 4)
      assert.calledWithExactly(states.on._enter, expected)
      assert.equal(states.off._enter.callCount, 5)

      assert.notCalled(callback)
    })
  })
})
