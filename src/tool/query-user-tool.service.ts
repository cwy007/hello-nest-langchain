import { tool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class QueryUserToolService {
  readonly tool;

  constructor(private readonly usersService: UsersService) {
    const queryUserArgsSchema = z.object({
      userId: z.string().describe('用户 ID，例如: 001, 002, 003'),
    });

    this.tool = tool(
      async ({ userId }: { userId: string }) => {
        const user = await this.usersService.findOne(+userId);

        if (!user) {
          const availableIds = (await this.usersService.findAll())
            .map((u) => u.id)
            .join(', ');

          return `用户 ID ${userId} 不存在。可用的 ID: ${availableIds}`;
        }

        return `用户信息：\n- ID: ${user.id}\n- 姓名: ${user.name}\n- 邮箱: ${user.email}`;
      },
      {
        name: 'query_user',
        description:
          '查询数据库中的用户信息。输入用户 ID，返回该用户的详细信息（姓名、邮箱、角色）。',
        schema: queryUserArgsSchema,
      },
    );
  }
}
