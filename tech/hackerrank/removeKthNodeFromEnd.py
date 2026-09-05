import math
import os
import random
import re
import sys

class SinglyLinkedListNode:
    def __init__(self, node_data):
        self.data = node_data
        self.next = None


class SinglyLinkedList:
    def __init__(self):
        self.head = None
        self.tail = None
    

    def insert_node(self, node_data):
        node = SinglyLinkedListNode(node_data)

        if not self.head:
            self.head = node
        else:
            self.tail.next = node
        
        self.tail = node

def print_singly_linked_list(node, sep):
    while node:
        print(node.data, end='')

        node = node.next

        if node:
            print(sep, end='')


def removeKthNodeFromEnd(head, k):
    array = []
    while head:
        array.append(head.data)
        head = head.next
    if k < len(array):
        array.pop(len(array) - 1 - k)
    result = SinglyLinkedList()
    for a in array:
        result.insert_node(a)
    return result.head

if __name__ == '__main__':
    head_count = int(input().strip())

    head = SinglyLinkedList()

    for _ in range(head_count):
        head_item = int(input().strip())
        head.insert_node(head_item)

    k = int(input().strip())

    result = removeKthNodeFromEnd(head.head, k)

    print_singly_linked_list(result, '\n')
    print()
