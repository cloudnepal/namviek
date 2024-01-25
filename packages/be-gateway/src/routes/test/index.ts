import { pmClient } from 'packages/shared-models/src/lib/_prisma'
import {
  BaseController,
  Controller,
  ExpressRequest,
  ExpressResponse,
  Get,
  Req,
  Res
} from '../../core'
import { CounterType } from '@prisma/client'
import { CKEY, incrCache, setCache } from '../../lib/redis'

import { TaskQueue, getTaskQueueInstance } from '../../queues'

@Controller('/test')
export class TestController extends BaseController {
  taskQueue: TaskQueue
  constructor() {
    super()

    this.taskQueue = getTaskQueueInstance()
  }

  @Get('/bullmq')
  async runQueue() {
    // await this.taskQueue.addJob('name', {
    //   updatedOrder: [['oijoisdf', '2']],
    //   projectId: '102938019283'
    // })
    return 1
  }

  @Get('/check-task-order')
  async getTaskWithoutOrder(
    @Req() req: ExpressRequest,
    @Res() res: ExpressResponse
  ) {
    const { isSet } = req.query as { isSet: string }

    // const tasks = await pmClient.task.findMany({
    //   where: {
    //     order: {
    //
    //     }
    //   },
    //   select: {
    //     id: true,
    //     order: true,
    //     title: true
    //   }
    // })

    res.json({
      // total: tasks.length,
      // data: tasks
    })
  }
  @Get('/update-task-order')
  async updateTaskOrder(@Res() res: ExpressResponse) {
    const tasks = await pmClient.task.findMany({
      // where: {
      //   order: { isSet: false }
      // },
      orderBy: {
        createdAt: 'asc'
      }
    })

    const projects = await pmClient.project.findMany({})

    console.log('reset all project counter')
    for (let j = 0; j < projects.length; j++) {
      const p = projects[j]

      const counterKey = [CKEY.PROJECT_TASK_COUNTER, p.id]
      await setCache(counterKey, 0)
    }

    console.log('start updating order by each project')
    const updateData = []
    for (let index = 0; index < tasks.length; index++) {
      const task = tasks[index]
      if (!task.projectId) continue

      const counterKey = [CKEY.PROJECT_TASK_COUNTER, task.projectId]
      const order = await incrCache(counterKey)

      updateData.push(
        pmClient.task.update({
          where: {
            id: task.id
          },
          data: {
            order
          },
          select: {
            id: true,
            order: true,
            title: true
          }
        })
      )
    }

    console.log('waiting for all updates done')
    const result = await Promise.allSettled(updateData)
    console.log('==> ok it is done')

    res.json({
      data: result
    })
  }
  @Get('/counter')
  async increaseTaskCounter(@Res() res: ExpressResponse) {
    const d = new Date()
    try {
      const counter = await pmClient.$transaction(async tx => {
        const result = await tx.counter.findFirst({
          where: {
            type: CounterType.TASK
          }
        })

        let total = 0

        if (result && result.counter) {
          total = result.counter
        }

        const counter = total + 1

        await tx.counter.update({
          where: {
            id: result.id
          },
          data: {
            counter
          }
        })

        return counter
      })

      const result = await pmClient.test.create({
        data: {
          title: 'Unititled ' + d.toString(),
          order: counter
        }
      })

      console.log(result.order, counter)

      res.json({
        result,
        counter
      })
    } catch (error) {
      console.log('failed', d.toString())
      res.status(500).send(error)
    }
  }

  @Get('/create-counter')
  async createCounter(@Res() res: ExpressResponse) {
    const result = await pmClient.counter.create({
      data: {
        type: CounterType.TASK,
        counter: 0
      }
    })

    res.json({
      result
    })
  }

  @Get('/cache-counter')
  async generateCounterFromRedis(@Res() res: ExpressResponse) {
    try {
      const counter = await incrCache([CKEY.PROJECT_TASK_COUNTER])
      const result = await pmClient.test.create({
        data: {
          title: 'Created from redis',
          order: counter
        }
      })
      console.log('called', counter, result.order)
      res.json({ order: result.order })
    } catch (error) {
      res.status(500).send(error)
    }
  }
}